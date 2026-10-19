//go:build integration

package kafka

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	segmentio "github.com/segmentio/kafka-go"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"einvoice/mail/internal/failure"
)

// Against a real single-node KRaft broker -- the same apache/kafka image and settings dev compose
// runs. What fakes can't show: that an uncommitted offset really is redelivered to the next member
// of the group, and that a committed one really isn't.

const kafkaImage = "apache/kafka:4.3.1"

func startKafka(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	// The broker must advertise an address the test (on the host) can reach, so the host port is
	// fixed up front instead of being assigned after start.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("pick port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	broker := fmt.Sprintf("localhost:%d", port)

	container, err := testcontainers.Run(ctx, kafkaImage,
		testcontainers.WithExposedPorts("9092/tcp"),
		testcontainers.WithHostConfigModifier(func(hc *container.HostConfig) {
			hc.PortBindings = network.PortMap{
				network.MustParsePort("9092/tcp"): {{HostIP: netip.MustParseAddr("127.0.0.1"), HostPort: strconv.Itoa(port)}},
			}
		}),
		testcontainers.WithEnv(map[string]string{
			"KAFKA_NODE_ID":                                  "1",
			"KAFKA_PROCESS_ROLES":                            "broker,controller",
			"KAFKA_LISTENERS":                                "PLAINTEXT://:9092,CONTROLLER://:9093",
			"KAFKA_ADVERTISED_LISTENERS":                     "PLAINTEXT://" + broker,
			"KAFKA_CONTROLLER_LISTENER_NAMES":                "CONTROLLER",
			"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP":           "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
			"KAFKA_CONTROLLER_QUORUM_VOTERS":                 "1@localhost:9093",
			"KAFKA_INTER_BROKER_LISTENER_NAME":               "PLAINTEXT",
			"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR":         "1",
			"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
			"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR":            "1",
			"KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS":         "0",
		}),
		testcontainers.WithWaitStrategy(wait.ForLog("Kafka Server started").WithStartupTimeout(90*time.Second)),
	)
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start kafka: %v", err)
	}
	return broker
}

func createTopic(t *testing.T, broker, topic string) {
	t.Helper()
	conn, err := segmentio.Dial("tcp", broker)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if err := conn.CreateTopics(segmentio.TopicConfig{Topic: topic, NumPartitions: 1, ReplicationFactor: 1}); err != nil {
		t.Fatalf("create topic %s: %v", topic, err)
	}
	// CreateTopics returns before the topic's metadata (and partition leader) has propagated;
	// producing straight away fails with "Unknown Topic Or Partition".
	waitFor(t, "topic "+topic+" to have a leader", func() bool {
		partitions, err := conn.ReadPartitions(topic)
		return err == nil && len(partitions) == 1 && partitions[0].Leader.Port != 0
	})
}

func produce(t *testing.T, broker, topic string, values ...string) {
	t.Helper()
	w := &segmentio.Writer{Addr: segmentio.TCP(broker), Topic: topic, RequiredAcks: segmentio.RequireAll}
	defer w.Close()
	msgs := make([]segmentio.Message, len(values))
	for i, v := range values {
		msgs[i] = segmentio.Message{Key: []byte("inv-1"), Value: []byte(v)}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// A just-created topic can still be unknown to the broker serving the write for a moment.
	for {
		err := w.WriteMessages(ctx, msgs...)
		if err == nil {
			return
		}
		if !errors.Is(err, segmentio.UnknownTopicOrPartition) || ctx.Err() != nil {
			t.Fatalf("produce: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// A consumer exactly like NewConsumer's, with millisecond backoff so retries don't slow the test.
func testConsumer(broker, group, topic, dlqTopic string) *Consumer {
	return newConsumer(
		segmentio.NewReader(segmentio.ReaderConfig{
			Brokers: []string{broker}, GroupID: group, Topic: topic, CommitInterval: 0,
			MaxWait: 200 * time.Millisecond,
		}),
		&segmentio.Writer{
			Addr: segmentio.TCP(broker), Topic: dlqTopic, Balancer: &segmentio.Hash{},
			RequiredAcks: segmentio.RequireAll, AllowAutoTopicCreation: true,
		},
		RetryPolicy{InitialBackoff: 20 * time.Millisecond, MaxBackoff: 100 * time.Millisecond},
	)
}

// recorder collects the values a consumer handled, and signals when a given value arrives.
type recorder struct {
	mu   sync.Mutex
	seen []string
}

func (r *recorder) add(v string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seen = append(r.seen, v)
}

func (r *recorder) values() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.seen...)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// runConsumer runs c until stop is called; stop also closes it (leaving the group cleanly).
func runConsumer(t *testing.T, c *Consumer, handle Handler) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := c.Run(ctx, handle); err != nil {
			t.Errorf("Run: %v", err)
		}
	}()
	return func() {
		cancel()
		<-done
		_ = c.Close()
	}
}

func readDLQ(t *testing.T, broker, topic string) segmentio.Message {
	t.Helper()
	r := segmentio.NewReader(segmentio.ReaderConfig{Brokers: []string{broker}, Topic: topic, MaxWait: 200 * time.Millisecond})
	defer r.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	msg, err := r.ReadMessage(ctx)
	if err != nil {
		t.Fatalf("read dead letter: %v", err)
	}
	return msg
}

func TestConsumerAgainstRealKafka(t *testing.T) {
	broker := startKafka(t)

	t.Run("retries transient failures, dead-letters poison, and commits both", func(t *testing.T) {
		createTopic(t, broker, "events-a")
		produce(t, broker, "events-a", "flaky", "poison")

		var attempts sync.Map
		got := &recorder{}
		stop := runConsumer(t, testConsumer(broker, "group-a", "events-a", "events-a.dlq"),
			func(_ context.Context, _, value []byte) error {
				v := string(value)
				got.add(v)
				n, _ := attempts.LoadOrStore(v, new(int))
				*n.(*int)++
				switch {
				case v == "flaky" && *n.(*int) == 1:
					return errors.New("smtp: 451 try again")
				case v == "poison":
					return failure.Permanent(errors.New("decode invoice event: bad json"))
				}
				return nil
			})

		dead := readDLQ(t, broker, "events-a.dlq")
		stop()

		if string(dead.Value) != "poison" || string(dead.Key) != "inv-1" {
			t.Fatalf("dead letter = %q/%q, want the poison message", dead.Key, dead.Value)
		}
		headers := map[string]string{}
		for _, h := range dead.Headers {
			headers[h.Key] = string(h.Value)
		}
		if headers[HeaderOriginalTopic] != "events-a" || headers[HeaderError] != "decode invoice event: bad json" {
			t.Fatalf("dead letter headers = %v", headers)
		}
		if seen := got.values(); len(seen) < 3 || seen[0] != "flaky" || seen[1] != "flaky" || seen[2] != "poison" {
			t.Fatalf("handled %v, want flaky (failed), flaky (ok), poison -- in order", seen)
		}

		// Both offsets were committed: a new member of the group starts after them.
		produce(t, broker, "events-a", "sentinel")
		next := &recorder{}
		stop = runConsumer(t, testConsumer(broker, "group-a", "events-a", "events-a.dlq"),
			func(_ context.Context, _, value []byte) error { next.add(string(value)); return nil })
		waitFor(t, "the sentinel", func() bool { return len(next.values()) > 0 })
		stop()
		if first := next.values()[0]; first != "sentinel" {
			t.Fatalf("restarted consumer first got %q, want \"sentinel\" (earlier offsets must be committed)", first)
		}
	})

	t.Run("redelivers a message whose consumer shut down mid-retry", func(t *testing.T) {
		createTopic(t, broker, "events-b")
		produce(t, broker, "events-b", "interrupted")

		// Consumer A keeps failing the message; we stop it (SIGTERM) while it's retrying.
		var calls int
		var mu sync.Mutex
		consumerA := testConsumer(broker, "group-b", "events-b", "events-b.dlq")
		stopA := runConsumer(t, consumerA, func(context.Context, []byte, []byte) error {
			mu.Lock()
			calls++
			mu.Unlock()
			return errors.New("smtp: connection refused")
		})
		waitFor(t, "consumer A to start retrying", func() bool { mu.Lock(); defer mu.Unlock(); return calls >= 2 })
		stopA()

		// Consumer B, same group, must get the same message: it was never committed.
		got := &recorder{}
		stopB := runConsumer(t, testConsumer(broker, "group-b", "events-b", "events-b.dlq"),
			func(_ context.Context, _, value []byte) error { got.add(string(value)); return nil })
		waitFor(t, "redelivery to consumer B", func() bool { return len(got.values()) > 0 })
		stopB()

		if first := got.values()[0]; first != "interrupted" {
			t.Fatalf("consumer B got %q, want the interrupted message", first)
		}
		t.Logf("consumer A attempted the message %s times before shutdown", strconv.Itoa(calls))
	})
}
