package failure

import (
	"errors"
	"fmt"
	"testing"
)

func TestPermanentSurvivesWrapping(t *testing.T) {
	root := errors.New("550 mailbox unavailable")
	err := fmt.Errorf("handle event: %w", Permanent(root))

	if !IsPermanent(err) {
		t.Fatal("a wrapped permanent error must still be permanent")
	}
	if !errors.Is(err, root) {
		t.Fatal("Permanent must keep the original error reachable with errors.Is")
	}
}

func TestUnmarkedErrorsAreTransient(t *testing.T) {
	if IsPermanent(errors.New("connection reset")) || IsPermanent(nil) {
		t.Fatal("only explicitly marked errors are permanent")
	}
	if Permanent(nil) != nil {
		t.Fatal("Permanent(nil) must be nil")
	}
}
