import {
  type Person, type InsertPerson,
  type Group, type InsertGroup,
  type Expense, type InsertExpense,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // People
  getPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  createPerson(person: InsertPerson): Promise<Person>;
  deletePerson(id: string): Promise<boolean>;

  // Groups
  getGroups(): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  deleteGroup(id: string): Promise<boolean>;

  // Expenses
  getExpenses(): Promise<Expense[]>;
  getExpensesByGroup(groupId: string): Promise<Expense[]>;
  getExpensesBetweenFriends(personId: string): Promise<Expense[]>;
  createExpense(expense: InsertExpense): Promise<Expense>;
  deleteExpense(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private people: Map<string, Person>;
  private groups: Map<string, Group>;
  private expenses: Map<string, Expense>;

  constructor() {
    this.people = new Map();
    this.groups = new Map();
    this.expenses = new Map();
  }

  // People
  async getPeople(): Promise<Person[]> {
    return Array.from(this.people.values());
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return this.people.get(id);
  }

  async createPerson(insertPerson: InsertPerson): Promise<Person> {
    const id = randomUUID();
    const person: Person = { ...insertPerson, id };
    this.people.set(id, person);
    return person;
  }

  async deletePerson(id: string): Promise<boolean> {
    return this.people.delete(id);
  }

  // Groups
  async getGroups(): Promise<Group[]> {
    return Array.from(this.groups.values());
  }

  async getGroup(id: string): Promise<Group | undefined> {
    return this.groups.get(id);
  }

  async createGroup(insertGroup: InsertGroup): Promise<Group> {
    const id = randomUUID();
    const group: Group = { ...insertGroup, id };
    this.groups.set(id, group);
    return group;
  }

  async deleteGroup(id: string): Promise<boolean> {
    return this.groups.delete(id);
  }

  // Expenses
  async getExpenses(): Promise<Expense[]> {
    return Array.from(this.expenses.values());
  }

  async getExpensesByGroup(groupId: string): Promise<Expense[]> {
    return Array.from(this.expenses.values()).filter(e => e.groupId === groupId);
  }

  async getExpensesBetweenFriends(personId: string): Promise<Expense[]> {
    return Array.from(this.expenses.values()).filter(
      e => !e.groupId && (e.paidById === personId || e.splitAmongIds.includes(personId))
    );
  }

  async createExpense(insertExpense: InsertExpense): Promise<Expense> {
    const id = randomUUID();
    const expense: Expense = { ...insertExpense, id };
    this.expenses.set(id, expense);
    return expense;
  }

  async deleteExpense(id: string): Promise<boolean> {
    return this.expenses.delete(id);
  }
}

export const storage = new MemStorage();
