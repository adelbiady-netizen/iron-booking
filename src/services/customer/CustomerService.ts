import { prisma } from '../../lib/prisma';
import type { ZoneType } from '@prisma/client';
import { NotFoundError, ConflictError } from '../../utils/errors';

export interface CreateCustomerInput {
  restaurantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  isVIP?: boolean;
  dietaryNotes?: string;
  internalNotes?: string;
  preferredZone?: ZoneType;
  preferredTableId?: string;
}

export interface UpdateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  isVIP?: boolean;
  isBlacklisted?: boolean;
  dietaryNotes?: string;
  internalNotes?: string;
  preferredZone?: ZoneType;
  preferredTableId?: string;
}

export class CustomerService {
  async create(input: CreateCustomerInput) {
    // Check uniqueness
    if (input.phone) {
      const existing = await prisma.customer.findUnique({
        where: { restaurantId_phone: { restaurantId: input.restaurantId, phone: input.phone } },
      });
      if (existing) throw new ConflictError(`Customer with phone ${input.phone} already exists`);
    }

    if (input.email) {
      const existing = await prisma.customer.findUnique({
        where: { restaurantId_email: { restaurantId: input.restaurantId, email: input.email } },
      });
      if (existing) throw new ConflictError(`Customer with email ${input.email} already exists`);
    }

    return prisma.customer.create({
      data: {
        restaurantId: input.restaurantId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        isVIP: input.isVIP ?? false,
        dietaryNotes: input.dietaryNotes,
        internalNotes: input.internalNotes,
        preferredZone: input.preferredZone,
        preferredTableId: input.preferredTableId,
      },
    });
  }

  async update(id: string, input: UpdateCustomerInput) {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundError('Customer', id);

    return prisma.customer.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        isVIP: input.isVIP,
        isBlacklisted: input.isBlacklisted,
        dietaryNotes: input.dietaryNotes,
        internalNotes: input.internalNotes,
        preferredZone: input.preferredZone,
        preferredTableId: input.preferredTableId,
      },
    });
  }

  async findById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        reservations: {
          orderBy: { startTime: 'desc' },
          take: 20,
          include: {
            tables: { include: { table: { select: { tableNumber: true } } } },
          },
        },
      },
    });
    if (!customer) throw new NotFoundError('Customer', id);
    return customer;
  }

  async search(restaurantId: string, query: string) {
    const terms = query.trim().split(/\s+/);
    return prisma.customer.findMany({
      where: {
        restaurantId,
        OR: [
          { firstName: { contains: terms[0], mode: 'insensitive' } },
          { lastName: { contains: terms[terms.length - 1], mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async findOrCreate(
    restaurantId: string,
    guestName: string,
    phone?: string,
    email?: string,
  ) {
    if (phone) {
      const existing = await prisma.customer.findUnique({
        where: { restaurantId_phone: { restaurantId, phone } },
      });
      if (existing) return existing;
    }

    if (email) {
      const existing = await prisma.customer.findUnique({
        where: { restaurantId_email: { restaurantId, email } },
      });
      if (existing) return existing;
    }

    const [firstName, ...rest] = guestName.trim().split(' ');
    return prisma.customer.create({
      data: {
        restaurantId,
        firstName: firstName ?? guestName,
        lastName: rest.join(' ') || '',
        phone,
        email,
      },
    });
  }
}
