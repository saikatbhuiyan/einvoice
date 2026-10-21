import {
  CreateInvoiceDto,
  DeleteInvoiceResponseDto,
  FindAllInvoicesResponseDto,
  InvoiceResponseDto,
  UpdateInvoiceDto,
} from '@libs/interfaces/gateway';

export const INVOICE_ID_EXAMPLE = '662f9d38f2ab7c001f52c901';

export const CUSTOMER_ID_EXAMPLE = '662f9d38f2ab7c001f52c9aa';

const PRODUCT_ID_EXAMPLE = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';

const CLIENT_EXAMPLE = {
  name: 'Acme Bangladesh Ltd.',
  email: 'finance@acme.example',
  address: 'House 12, Road 8, Gulshan, Dhaka 1212',
};

/**
 * A one-off client, given inline. Drafts are unnumbered: the number is assigned on issue. The first
 * line is from the catalog (name, price and rates come from the product); the second is free-form,
 * with Bangladesh supplementary duty (VAT is charged on net + SD).
 */
export const CREATE_INVOICE_EXAMPLE: CreateInvoiceDto = {
  reference: 'PO-4471',
  currency: 'BDT',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: CLIENT_EXAMPLE,
  items: [
    { productId: PRODUCT_ID_EXAMPLE, quantity: 2 },
    {
      catalogId: 'AIR-PURIFIER-X2',
      name: 'Imported air purifier',
      quantity: 1,
      unitPrice: 20000,
      vatRate: 15,
      sdRate: 20,
    },
  ],
};

/** A saved customer: their current details are snapshotted onto the invoice. */
export const CREATE_INVOICE_FOR_CUSTOMER_EXAMPLE: CreateInvoiceDto = {
  customerId: CUSTOMER_ID_EXAMPLE,
  currency: 'BDT',
  dueDate: '2026-05-28',
  items: CREATE_INVOICE_EXAMPLE.items,
};

export const UPDATE_INVOICE_EXAMPLE: UpdateInvoiceDto = {
  notes: 'Payment due within 14 days.',
};

export const INVOICE_RESPONSE_EXAMPLE: InvoiceResponseDto = {
  id: INVOICE_ID_EXAMPLE,
  organizationId: '00000000-0000-4000-8000-000000000001',
  invoiceNumber: 'INV-2026-000001',
  reference: 'PO-4471',
  customerId: null,
  currency: 'BDT',
  status: 'issued',
  issueDate: '2026-04-28',
  dueDate: '2026-05-28',
  notes: 'Payment due within 30 days.',
  client: CLIENT_EXAMPLE,
  items: [
    {
      productId: PRODUCT_ID_EXAMPLE,
      catalogId: 'SKU-SUBSCRIPTION-PRO',
      name: 'Enterprise subscription',
      quantity: 2,
      unitPrice: 15000,
      vatRate: 15,
      sdRate: 0,
      net: 30000,
      sd: 0,
      vat: 4500,
      total: 34500,
    },
    {
      catalogId: 'AIR-PURIFIER-X2',
      name: 'Imported air purifier',
      quantity: 1,
      unitPrice: 20000,
      vatRate: 15,
      sdRate: 20,
      net: 20000,
      sd: 4000,
      vat: 3600,
      total: 27600,
    },
  ],
  subtotal: 50000,
  sdTotal: 4000,
  vatTotal: 8100,
  total: 62100,
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
