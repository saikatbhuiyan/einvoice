package kafka

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	segmentio "github.com/segmentio/kafka-go"

	"einvoice/mail/internal/failure"
)

// fakeReader serves queued messages, then blocks until ctx is cancelled (like a real reader with
// nothing new on the topic).
type fakeReader struct {
	mu        sync.Mutex
	queue     []segmentio.Message
	fetchErrs []error
	committed []int64
}

func (r *fakeReader) FetchMessage(ctx context.Context) (segmentio.Message, error) {
	r.mu.Lock()
	if len(r.fetchErrs) > 0 {
		err := r.fetchErrs[0]
		r.fetchErrs = r.fetchErrs[1:]
		r.mu.Unlock()
		return segmentio.Message{}, err
	}
	if len(r.queue) > 0 {
		msg := r.queue[0]
		r.queue = r.queue[1:]
		r.mu.Unlock()
		return msg, nil
	}
	r.mu.Unlock()
	<-ctx.Done()
	return segmentio.Message{}, ctx.Err()
}

func (r *fakeReader) CommitMessages(_ context.Context, msgs ...segmentio.Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range msgs {
		r.committed = append(r.committed, m.Offset)
	}
	return nil
}

func (r *fakeReader) Close() error { return nil }

type fakeWriter struct {
	mu      sync.Mutex
	errs    []error
	written []segmentio.Message
}

func (w *fakeWriter) WriteMessages(_ context.Context, msgs ...segmentio.Message) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.errs) > 0 {
		err := w.errs[0]
		w.errs = w.errs[1:]
		return err
	}
	w.written = append(w.written, msgs...)
	return nil
}

func (w *fakeWriter) Close() error { return nil }

func message(offset int64) segmentio.Message {
	return segmentio.Message{Topic: "invoice.events", Partition: 2, Offset: offset, Key: []byte("inv-1"), Value: []byte(`{"v":1}`)}
}

// run drives the consumer until `done` reports true (or a timeout), with sleeps recorded instead of
// slept.
func run(t *testing.T, r *fakeReader, w *fakeWriter, handle Handler, done func() bool) []time.Duration {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var sleeps []time.Duration
	c := newConsumer(r, w, RetryPolicy{InitialBackoff: time.Second, MaxBackoff: 8 * time.Second})
	c.sleep = func(ctx context.Context, d time.Duration) bool {
		mu.Lock()
		sleeps = append(sleeps, d)
		mu.Unlock()
		return ctx.Err() == nil
	}

	finished := make(chan error, 1)
	go func() { finished <- c.Run(ctx, handle) }()

	deadline := time.After(5 * time.Second)
	for !done() {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for the consumer")
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	if err := <-finished; err != nil {
		t.Fatalf("Run: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	return sleeps
}

func (r *fakeReader) committedOffsets() []int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]int64(nil), r.committed...)
}

func TestCommitsOnlyAfterTheHandlerSucceeds(t *testing.T) {
	r := &fakeReader{queue: []segmentio.Message{message(10), message(11)}}
	var handled int
	handle := func(context.Context, []byte, []byte) error {
		if got := len(r.committedOffsets()); got != handled {
			t.Errorf("offset committed before its message was handled (%d commits, %d handled)", got, handled)
		}
		handled++
		return nil
	}

	run(t, r, &fakeWriter{}, handle, func() bool { return len(r.committedOffsets()) == 2 })

	if got := r.committedOffsets(); got[0] != 10 || got[1] != 11 {
		t.Fatalf("committed %v, want [10 11]", got)
	}
}

// The bug this replaced: ReadMessage committed before handling, so one SMTP hiccup lost the email.
func TestRetriesATransientFailureInPlaceWithoutCommitting(t *testing.T) {
	r := &fakeReader{queue: []segmentio.Message{message(10), message(11)}}
	var calls []int64
	attempts := 0
	handle := func(_ context.Context, _, value []byte) error {
		calls = append(calls, int64(len(calls)))
		attempts++
		if attempts <= 3 {
			if len(r.committedOffsets()) != 0 {
				t.Error("committed while the message was still failing")
			}
			return errors.New("smtp: 451 try again")
		}
		return nil
	}

	sleeps := run(t, r, &fakeWriter{}, handle, func() bool { return len(r.committedOffsets()) == 2 })

	if attempts != 5 { // 3 failures + success for offset 10, then offset 11
		t.Fatalf("handler called %d times, want 5", attempts)
	}
	if got := r.committedOffsets(); len(got) != 2 || got[0] != 10 || got[1] != 11 {
		t.Fatalf("committed %v, want [10 11] — in order, after the retries", got)
	}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}
	if len(sleeps) != len(want) {
		t.Fatalf("backoff %v, want %v", sleeps, want)
	}
	for i := range want {
		if sleeps[i] != want[i] {
			t.Fatalf("backoff %v, want %v", sleeps, want)
		}
	}
}

func TestDeadLettersAPermanentFailureWithItsOriginThenCommits(t *testing.T) {
	r := &fakeReader{queue: []segmentio.Message{message(42)}}
	w := &fakeWriter{}
	handle := func(context.Context, []byte, []byte) error {
		return failure.Permanent(errors.New("decode invoice event: bad json"))
	}

	run(t, r, w, handle, func() bool { return len(r.committedOffsets()) == 1 })

	if len(w.written) != 1 {
		t.Fatalf("dead-lettered %d messages, want 1", len(w.written))
	}
	dead := w.written[0]
	if string(dead.Key) != "inv-1" || string(dead.Value) != `{"v":1}` {
		t.Fatalf("dead letter must carry the original key and value, got %q / %q", dead.Key, dead.Value)
	}
	headers := map[string]string{}
	for _, h := range dead.Headers {
		headers[h.Key] = string(h.Value)
	}
	for key, want := range map[string]string{
		HeaderError:             "decode invoice event: bad json",
		HeaderOriginalTopic:     "invoice.events",
		HeaderOriginalPartition: "2",
		HeaderOriginalOffset:    "42",
		HeaderAttempts:          "1",
	} {
		if headers[key] != want {
			t.Fatalf("header %s = %q, want %q (all: %v)", key, headers[key], want, headers)
		}
	}
	if headers[HeaderDeadLetteredAt] == "" {
		t.Fatal("missing dead-lettered-at header")
	}
}

// The source offset must not be committed while the message exists nowhere else.
func TestDoesNotCommitUntilTheDeadLetterIsWritten(t *testing.T) {
	r := &fakeReader{queue: []segmentio.Message{message(7)}}
	w := &fakeWriter{errs: []error{errors.New("broker down"), errors.New("broker down")}}
	handle := func(context.Context, []byte, []byte) error { return failure.Permanent(errors.New("poison")) }

	run(t, r, w, handle, func() bool { return len(r.committedOffsets()) == 1 })

	if len(w.written) != 1 {
		t.Fatalf("dead letter written %d times, want 1 (after two failed attempts)", len(w.written))
	}
}

// Shutting down mid-retry leaves the message uncommitted: redelivered after restart, not lost.
func TestLeavesTheMessageUncommittedWhenShutDownMidRetry(t *testing.T) {
	r := &fakeReader{queue: []segmentio.Message{message(10)}}
	ctx, cancel := context.WithCancel(context.Background())
	c := newConsumer(r, &fakeWriter{}, DefaultRetryPolicy)
	c.sleep = func(ctx context.Context, _ time.Duration) bool {
		cancel() // SIGTERM arrives while waiting to retry
		return ctx.Err() == nil
	}

	if err := c.Run(ctx, func(context.Context, []byte, []byte) error { return errors.New("smtp down") }); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := r.committedOffsets(); len(got) != 0 {
		t.Fatalf("committed %v on shutdown, want nothing", got)
	}
}

func TestRetriesAFailedFetch(t *testing.T) {
	r := &fakeReader{
		fetchErrs: []error{errors.New("Group Coordinator Not Available")},
		queue:     []segmentio.Message{message(1)},
	}

	run(t, r, &fakeWriter{}, func(context.Context, []byte, []byte) error { return nil },
		func() bool { return len(r.committedOffsets()) == 1 })
}

func TestBackoffDoublesAndCaps(t *testing.T) {
	c := newConsumer(&fakeReader{}, &fakeWriter{}, RetryPolicy{InitialBackoff: time.Second, MaxBackoff: time.Minute})
	want := []time.Duration{1, 2, 4, 8, 16, 32, 60, 60}
	for i, w := range want {
		if got := c.backoff(i + 1); got != w*time.Second {
			t.Fatalf("backoff(%d) = %v, want %v", i+1, got, w*time.Second)
		}
	}
}
