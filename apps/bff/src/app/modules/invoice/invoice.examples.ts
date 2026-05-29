import {
  CreateInvoiceDto,
  DeleteInvoiceResponseDto,
  FindAllInvoicesResponseDto,
  InvoiceResponseDto,
  UpdateInvoiceDto,
} from '@libs/interfaces/gateway';

export const INVOICE_ID_EXAMPLE = '662f9d38f2ab7c001f52c901';

export const CREATE_INVOICE_EXAMPLE: CreateInvoiceDto = {
  invoiceNumber: 'INV-2026-0001',
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: {
    name: 'Acme Bangladesh Ltd.',
    email: 'finance@acme.example',
    address: 'House 12, Road 8, Gulshan, Dhaka 1212',
  },
  items: [
    {
      catalogId: 'SKU-SUBSCRIPTION-PRO',
      name: 'Enterprise subscription',
      quantity: 2,
      unitPrice: 15000,
      vatRate: 15,
    },
  ],
};

export const UPDATE_INVOICE_EXAMPLE: UpdateInvoiceDto = {
  status: 'paid',
  notes: 'Paid by bank transfer.',
};

export const INVOICE_RESPONSE_EXAMPLE: InvoiceResponseDto = {
  id: INVOICE_ID_EXAMPLE,
  invoiceNumber: 'INV-2026-0001',
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: CREATE_INVOICE_EXAMPLE.client,
  items: [
    {
      ...CREATE_INVOICE_EXAMPLE.items[0],
      total: 34500,
    },
  ],
  subtotal: 30000,
  vatTotal: 4500,
  total: 34500,
  version: 1,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
};

export const FIND_ALL_RESPONSE_EXAMPLE: FindAllInvoicesResponseDto = {
  items: [INVOICE_RESPONSE_EXAMPLE],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

export const DELETE_INVOICE_RESPONSE_EXAMPLE: DeleteInvoiceResponseDto = {
  id: INVOICE_ID_EXAMPLE,
  deleted: true,
};
