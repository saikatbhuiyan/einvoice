// Package failure distinguishes errors that retrying can never fix (permanent) from the default:
// everything else is treated as transient and retried. Whoever understands an error marks it
// (the sender knows SMTP reply codes, the store knows a missing object); the consumer only asks.
package failure

import "errors"

type permanentError struct{ err error }

func (p permanentError) Error() string { return p.err.Error() }
func (p permanentError) Unwrap() error { return p.err }

// Permanent marks err as one that will fail the same way on every retry -- the message is
// dead-lettered instead. Wrapping nil returns nil.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err: err}
}

// IsPermanent reports whether err, or any error it wraps, was marked Permanent.
func IsPermanent(err error) bool {
	var p permanentError
	return errors.As(err, &p)
}
