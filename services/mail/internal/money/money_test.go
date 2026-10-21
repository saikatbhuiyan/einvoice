package money

import (
	"math"
	"testing"
)

func TestFormat(t *testing.T) {
	cases := []struct {
		minor    int64
		currency string
		want     string
	}{
		// Same strings @libs/money's formatMoney (Intl, en-IN for BDT) produces for the PDF.
		{1234567850, "BDT", "৳1,23,45,678.50"},
		{150000000, "BDT", "৳15,00,000.00"},
		{12345600, "BDT", "৳1,23,456.00"},
		{99999, "BDT", "৳999.99"},
		{100000, "BDT", "৳1,000.00"},
		{5, "BDT", "৳0.05"},
		{0, "BDT", "৳0.00"},
		{-150050, "BDT", "-৳1,500.50"},
		{123456750, "USD", "$1,234,567.50"},
		{12990, "EUR", "€129.90"},
		{5, "GBP", "£0.05"},
		{100000, "XYZ", "1,000.00 XYZ"},
		{math.MinInt64, "USD", "-$92,233,720,368,547,758.08"},
	}
	for _, c := range cases {
		if got := Format(c.minor, c.currency); got != c.want {
			t.Errorf("Format(%d, %s) = %q, want %q", c.minor, c.currency, got, c.want)
		}
	}
}

func TestFromEventPrefersTotalMinor(t *testing.T) {
	minor := int64(138000050)
	if got := FromEvent(&minor, 1.0, "BDT"); got != 138000050 {
		t.Fatalf("got %d", got)
	}
}

func TestFromEventFallsBackToTheDecimalTotalOfOlderEvents(t *testing.T) {
	// 1500.55 * 100 is 150054.99999999997 in binary floating point; rounding recovers the amount.
	if got := FromEvent(nil, 1500.55, "BDT"); got != 150055 {
		t.Fatalf("got %d", got)
	}
	if got := FromEvent(nil, 129.9, "EUR"); got != 12990 {
		t.Fatalf("got %d", got)
	}
}
