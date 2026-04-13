export const INVOICE_PATTERNS = {
  CREATE: 'invoice.create',
  FIND_ONE: 'invoice.findOne',
  FIND_ALL: 'invoice.findAll',
  UPDATE: 'invoice.update',
  DELETE: 'invoice.delete',
  BULK_CREATE: 'invoice.bulkCreate',
} as const;

export const USER_PATTERNS = {
  CREATE: 'user.create',
  FIND_ONE: 'user.findOne',
  FIND_BY_EMAIL: 'user.findByEmail',
  UPDATE: 'user.update',
  DELETE: 'user.delete',
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
} as const;

export const TCP_PATTERNS = {
  INVOICE: INVOICE_PATTERNS,
  USER: USER_PATTERNS,
  NOTIFICATION: NOTIFICATION_PATTERNS,
  PAYMENT: PAYMENT_PATTERNS,
} as const;
