import type { Employee, Student } from '@prisma/client';
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

export function serializeStudent(student: Student) {
  return {
    id: student.id,
    studentId: student.studentId,
    firstName: student.firstName,
    lastName: student.lastName,
    fullName: `${student.firstName} ${student.lastName}`,
    email: student.email,
    programme: student.programme,
    active: student.active,
    createdAt: isoRequired(student.createdAt),
    updatedAt: isoRequired(student.updatedAt),
  };
}
