export const INVOICE_PATTERNS = {
  CREATE: 'invoice.create',
  FIND_ONE: 'invoice.findOne',
  FIND_ALL: 'invoice.findAll',
  UPDATE: 'invoice.update',
  DELETE: 'invoice.delete',
  BULK_CREATE: 'invoice.bulkCreate',
  GENERATE_PDF: 'invoice.generatePdf',
  GET_PDF_URL: 'invoice.getPdfUrl',
  ISSUE: 'invoice.issue',
  CANCEL: 'invoice.cancel',
  SEND: 'invoice.send',
  MARK_PAID: 'invoice.markPaid',
} as const;

// Served by invoice (customers share its database: an invoice snapshots its customer locally).
export const CUSTOMER_PATTERNS = {
  CREATE: 'customer.create',
  FIND_ALL: 'customer.findAll',
  FIND_ONE: 'customer.findOne',
  UPDATE: 'customer.update',
  DELETE: 'customer.delete',
} as const;

export const PRODUCT_PATTERNS = {
  CREATE: 'product.create',
  FIND_ALL: 'product.findAll',
} as const;

export const USER_PATTERNS = {
  CREATE: 'user.create',
  FIND_ALL: 'user.findAll',
  FIND_ONE: 'user.findOne',
  FIND_BY_EMAIL: 'user.findByEmail',
  UPDATE: 'user.update',
  DELETE: 'user.delete',
} as const;

// Served by user-access, over the same TCP port as USER_PATTERNS. Platform-scoped (platform:admin):
// they act across organizations, so the caller needs no active organization.
export const ORGANIZATION_PATTERNS = {
  CREATE: 'organization.create',
  FIND_ALL: 'organization.findAll',
  FIND_ONE: 'organization.findOne',
  /** The caller's active organization (organization:read). */
  FIND_CURRENT: 'organization.findCurrent',
  /** Its admin changing its settings: name, invoice prefix, reminder schedule (organization:write). */
  UPDATE_CURRENT: 'organization.updateCurrent',
  /**
   * Service-to-service (invoice): the invoice-numbering settings of the organization the call
   * carries. Public -- numbering happens with or without an end user behind it.
   */
  INVOICE_SETTINGS: 'organization.invoiceSettings',
} as const;

export const ROLE_PATTERNS = {
  FIND_ALL: 'role.findAll',
} as const;

export const NOTIFICATION_PATTERNS = {
  SEND_EMAIL: 'notification.sendEmail',
  SEND_SMS: 'notification.sendSms',
  SEND_PUSH: 'notification.sendPush',
} as const;

export const PAYMENT_PATTERNS = {
  INITIATE: 'payment.initiate',
  VERIFY: 'payment.verify',
  REFUND: 'payment.refund',
  WEBHOOK: 'payment.handleWebhookEvent',
} as const;

export const PDF_GENERATOR_PATTERNS = {
  GENERATE_INVOICE_PDF: 'pdfGenerator.generateInvoicePdf',
} as const;

export const MEDIA_PATTERNS = {
  UPLOAD: 'media.upload',
  GET_DOWNLOAD_URL: 'media.getDownloadUrl',
} as const;

export const TCP_PATTERNS = {
  INVOICE: INVOICE_PATTERNS,
  CUSTOMER: CUSTOMER_PATTERNS,
  PRODUCT: PRODUCT_PATTERNS,
  USER: USER_PATTERNS,
  ROLE: ROLE_PATTERNS,
  ORGANIZATION: ORGANIZATION_PATTERNS,
  NOTIFICATION: NOTIFICATION_PATTERNS,
  PAYMENT: PAYMENT_PATTERNS,
  PDF_GENERATOR: PDF_GENERATOR_PATTERNS,
  MEDIA: MEDIA_PATTERNS,
} as const;
