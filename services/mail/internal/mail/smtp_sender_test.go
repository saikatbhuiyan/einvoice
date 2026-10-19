package mail

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"

	gomail "github.com/wneessen/go-mail"

	"einvoice/mail/internal/failure"
)

// dropAtRcpt as the RCPT TO reply makes the server hang up mid-transaction instead of answering.
const dropAtRcpt = "<drop>"

// fakeSMTPServer speaks just enough SMTP for go-mail to send one message, replying `rcptReply` to
// RCPT TO (or hanging up there, with dropAtRcpt) -- or, with dropAfterGreeting, hanging up right
// after the greeting. A hang-up is a network failure, not an SMTP reply.
func fakeSMTPServer(t *testing.T, rcptReply string, dropAfterGreeting bool) (host string, port int) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		write := func(line string) { _, _ = conn.Write([]byte(line + "\r\n")) }

		write("220 fake.smtp ready")
		if dropAfterGreeting {
			return
		}
		reader := bufio.NewReader(conn)
		inData := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			if inData {
				if line == "." {
					inData = false
					write("250 queued")
				}
				continue
			}
			switch command := strings.ToUpper(line); {
			case strings.HasPrefix(command, "EHLO"), strings.HasPrefix(command, "HELO"):
				write("250 fake.smtp")
			case strings.HasPrefix(command, "MAIL FROM"):
				write("250 ok")
			case strings.HasPrefix(command, "RCPT TO"):
				if rcptReply == dropAtRcpt {
					return
				}
				write(rcptReply)
			case command == "DATA":
				inData = true
				write("354 go ahead")
			case command == "RSET":
				write("250 ok")
			case command == "QUIT":
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()

	addr := listener.Addr().(*net.TCPAddr)
	return addr.IP.String(), addr.Port
}

// Production uses mandatory TLS + auth (NewSMTPSender); what's under test here is the error
// classification, so the client talks plaintext to the fake server.
func plaintextSender(t *testing.T, host string, port int) *SMTPSender {
	t.Helper()
	client, err := gomail.NewClient(host, gomail.WithPort(port), gomail.WithTLSPolicy(gomail.NoTLS))
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	return &SMTPSender{from: "billing@einvoice.test", client: client}
}

func sendOne(t *testing.T, sender *SMTPSender) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return sender.Send(ctx, Message{To: "client@example.test", Subject: "Invoice", HTMLBody: "<p>hi</p>"})
}

func TestSMTPSendClassifiesFailures(t *testing.T) {
	cases := []struct {
		name          string
		rcptReply     string
		dropConn      bool
		wantPermanent bool
	}{
		{name: "mailbox does not exist (550) is permanent", rcptReply: "550 5.1.1 no such user", wantPermanent: true},
		{name: "greylisting (451) is transient", rcptReply: "451 4.7.1 try again later", wantPermanent: false},
		// Bad credentials refuse every message: pause delivery and fix config, don't dead-letter them all.
		{name: "auth failure (535) is transient", rcptReply: "535 5.7.8 authentication failed", wantPermanent: false},
		{name: "connection dropped before the transaction is transient", dropConn: true, wantPermanent: false},
		// go-mail wraps this one in a SendError whose IsTemp() is false (its text doesn't start with
		// '4'); classifying by the SMTP reply code instead keeps it transient.
		{name: "connection dropped mid-transaction is transient", rcptReply: dropAtRcpt, wantPermanent: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			host, port := fakeSMTPServer(t, tc.rcptReply, tc.dropConn)

			err := sendOne(t, plaintextSender(t, host, port))

			if err == nil {
				t.Fatal("expected the send to fail")
			}
			if got := failure.IsPermanent(err); got != tc.wantPermanent {
				t.Fatalf("IsPermanent = %v, want %v (err: %v)", got, tc.wantPermanent, err)
			}
		})
	}
}

func TestSMTPSendSucceedsAgainstAcceptingServer(t *testing.T) {
	host, port := fakeSMTPServer(t, "250 ok", false)

	if err := sendOne(t, plaintextSender(t, host, port)); err != nil {
		t.Fatalf("Send: %v", err)
	}
}

func TestMalformedRecipientIsPermanent(t *testing.T) {
	sender := plaintextSender(t, "127.0.0.1", 1)

	err := sender.Send(context.Background(), Message{To: "not an address", Subject: "s", HTMLBody: "b"})

	if !failure.IsPermanent(err) {
		t.Fatalf("a recipient that can never be addressed must be permanent, got %v", err)
	}
}
