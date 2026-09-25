import {
  CreateUserDto,
  FindAllRolesResponseDto,
  FindAllUsersResponseDto,
  UserResponseDto,
} from '@libs/interfaces/gateway';

export const USER_ID_EXAMPLE = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';
export const ROLE_ID_EXAMPLE = '9b6b3f2a-1c1e-4b9a-8f2e-2a6e2f9c9a10';

export const CREATE_USER_EXAMPLE: CreateUserDto = {
  email: 'finance@acme.example',
  name: 'Jane Doe',
  roleId: ROLE_ID_EXAMPLE,
};

const ROLE_EXAMPLE = {
  id: ROLE_ID_EXAMPLE,
  name: 'accountant',
  description: 'Reads and writes invoices, reads the product catalog. No user management.',
  permissions: ['invoice:read', 'invoice:write', 'product:read'],
  isActive: true,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
};

export const USER_RESPONSE_EXAMPLE: UserResponseDto = {
  id: USER_ID_EXAMPLE,
  email: CREATE_USER_EXAMPLE.email,
  name: CREATE_USER_EXAMPLE.name,
  role: ROLE_EXAMPLE,
  isActive: true,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-28T10:30:00.000Z',
};

export const FIND_ALL_USERS_RESPONSE_EXAMPLE: FindAllUsersResponseDto = {
  items: [USER_RESPONSE_EXAMPLE],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

export const FIND_ALL_ROLES_RESPONSE_EXAMPLE: FindAllRolesResponseDto = {
  items: [ROLE_EXAMPLE],
};
