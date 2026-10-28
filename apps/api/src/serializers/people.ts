import type { Employee } from '@prisma/client';
import { isoRequired } from '../time.js';

export function serializeEmployee(employee: Employee) {
  return {
    id: employee.id,
    code: employee.code,
    firstName: employee.firstName,
    lastName: employee.lastName,
    fullName: `${employee.firstName} ${employee.lastName}`,
    email: employee.email,
    phone: employee.phone,
    department: employee.department,
    jobTitle: employee.jobTitle,
    category: employee.category as 'staff' | 'contractor',
    active: employee.active,
    createdAt: isoRequired(employee.createdAt),
    updatedAt: isoRequired(employee.updatedAt),
  };
}
