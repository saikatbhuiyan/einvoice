// Package template renders the invoice notification email. html/template auto-escapes every
// field it interpolates, which matters here specifically: ClientName/InvoiceNumber ultimately
// originate from user-supplied invoice data (apps/invoice's CreateInvoiceRequest), not from a
// trusted internal source, so this is the one place in the whole pipeline where that data lands
// in HTML that then gets rendered by someone's mail client.
package template

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
)

//go:embed templates/invoice_email.html.tmpl
var invoiceEmailSource string

//go:embed templates/reminder_email.html.tmpl
var reminderEmailSource string

var invoiceEmailTemplate = template.Must(template.New("invoice_email").Parse(invoiceEmailSource))

var reminderEmailTemplate = template.Must(template.New("reminder_email").Parse(reminderEmailSource))

type InvoiceEmailData struct {
	ClientName    string
	InvoiceNumber string
	Currency      string
	Total         string
	IssueDate     string
	DueDate       string
}

func RenderInvoiceEmail(data InvoiceEmailData) (string, error) {
	var buf bytes.Buffer
	if err := invoiceEmailTemplate.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render invoice email template: %w", err)
	}
	return buf.String(), nil
}

// ReminderEmailData is a payment reminder for an overdue invoice. Like InvoiceEmailData, every field
// is escaped by html/template: ClientName and InvoiceNumber originate in user-supplied invoice data.
type ReminderEmailData struct {
	ClientName     string
	InvoiceNumber  string
	Currency       string
	Total          string
	DueDate        string
	DaysOverdue    int
	ReminderNumber int
}

func RenderReminderEmail(data ReminderEmailData) (string, error) {
	var buf bytes.Buffer
	if err := reminderEmailTemplate.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("render reminder email template: %w", err)
	}
	return buf.String(), nil
}
