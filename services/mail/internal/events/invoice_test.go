package events

import "testing"

func TestDecodeIgnoresEventTypesThisServiceDoesNotHandle(t *testing.T) {
	event, meta, ok, err := Decode([]byte(`{"data":{"type":"invoice.voided","invoiceId":"x"},"meta":{"correlationId":"c1"}}`))

	if err != nil || ok || event != nil {
		t.Fatalf("got event=%v ok=%v err=%v, want ignored without error", event, ok, err)
	}
	if meta.CorrelationID != "c1" {
		t.Fatalf("meta should still be decoded for logging, got %+v", meta)
	}
}

func TestDecodeRejectsMalformedMessages(t *testing.T) {
	cases := map[string]string{
		"not json":           `{"data":`,
		"data is not object": `{"data":"invoice.demo","meta":{}}`,
		"wrong field type":   `{"data":{"type":"invoice.pdf.generated","total":"129.90"},"meta":{}}`,
		"type is not string": `{"data":{"type":42},"meta":{}}`,
	}

	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, _, err := Decode([]byte(raw)); err == nil {
				t.Fatalf("Decode(%s) returned no error", raw)
			}
		})
	}
}

// The TS producer adds fields over time (traceparent/tracestate arrived with tracing). The Go
// side must keep decoding envelopes that carry fields it doesn't know.
func TestDecodeToleratesFieldsItDoesNotKnow(t *testing.T) {
	raw := `{
	  "data": {"type":"invoice.demo","invoiceId":"i1","message":"m","futureField":true},
	  "meta": {"correlationId":"c1","traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01","tracestate":"x=1"}
	}`

	event, _, ok, err := Decode([]byte(raw))
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if event.(DemoEvent).InvoiceID != "i1" {
		t.Fatalf("event = %+v", event)
	}
}
