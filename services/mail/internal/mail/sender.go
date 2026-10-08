// Package mail is the DI boundary for this service: one small Sender interface, swappable
// implementations behind it -- the same "one interface, one swappable struct" shape
// StorageProvider/PaymentProvider already use on the TypeScript side of this project, expressed
// in Go via an interface + constructor functions instead of a DI container (Go has no
// container-based DI convention the way Nest does; passing the interface value at construction
// time is the idiomatic equivalent).
package mail

import "context"

type Attachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

type Message struct {
	To          string
	Subject     string
	HTMLBody    string
	Attachments []Attachment
}

type Sender interface {
	Send(ctx context.Context, msg Message) error
}
