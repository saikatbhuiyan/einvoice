// Package money formats invoice amounts for emails. Amounts arrive as integers in the currency's
// minor unit (poisha, cents); this mirrors the TypeScript side's @libs/money display rules, which
// the PDF uses: the currency's symbol, and lakh/crore grouping for BDT (৳1,23,45,678.50).
package money

import (
	"math"
	"strconv"
	"strings"
)

type currency struct {
	exponent int
	symbol   string
	// South Asian grouping: the last three digits, then pairs (1,23,45,678).
	lakh bool
}

// The currencies invoice supports (SUPPORTED_CURRENCIES). ISO 4217 exponents.
var currencies = map[string]currency{
	"BDT": {exponent: 2, symbol: "৳", lakh: true},
	"USD": {exponent: 2, symbol: "$"},
	"EUR": {exponent: 2, symbol: "€"},
	"GBP": {exponent: 2, symbol: "£"},
}

// Format renders minor units for display. An unknown currency still renders, with two decimals and
// its code after the amount, rather than failing an email over presentation.
func Format(minor int64, code string) string {
	c, known := currencies[code]
	if !known {
		c = currency{exponent: 2}
	}

	sign := ""
	abs := uint64(minor)
	if minor < 0 {
		sign = "-"
		abs = uint64(-(minor + 1)) + 1 // safe for math.MinInt64
	}

	scale := uint64(math.Pow10(c.exponent))
	whole := group(strconv.FormatUint(abs/scale, 10), c.lakh)
	amount := whole
	if c.exponent > 0 {
		fraction := strconv.FormatUint(abs%scale, 10)
		amount += "." + strings.Repeat("0", c.exponent-len(fraction)) + fraction
	}

	if !known {
		return sign + amount + " " + code
	}
	return sign + c.symbol + amount
}

// FromEvent is the amount an event carries, in minor units: totalMinor when present, else the
// decimal total of events produced before totalMinor existed (exact for two-decimal amounts below
// 2^53 minor units, rounded to the nearest minor unit).
func FromEvent(totalMinor *int64, total float64, code string) int64 {
	if totalMinor != nil {
		return *totalMinor
	}
	exponent := 2
	if c, known := currencies[code]; known {
		exponent = c.exponent
	}
	return int64(math.Round(total * math.Pow10(exponent)))
}

func group(digits string, lakh bool) string {
	if len(digits) <= 3 {
		return digits
	}
	head, tail := digits[:len(digits)-3], digits[len(digits)-3:]
	size := 3
	if lakh {
		size = 2
	}
	var parts []string
	for len(head) > size {
		parts = append([]string{head[len(head)-size:]}, parts...)
		head = head[:len(head)-size]
	}
	parts = append([]string{head}, parts...)
	return strings.Join(append(parts, tail), ",")
}
