import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPersonSchema, insertGroupSchema, insertExpenseSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ========== People ==========
  app.get("/api/people", async (_req, res) => {
    const people = await storage.getPeople();
    res.json(people);
  });

  app.post("/api/people", async (req, res) => {
    const parsed = insertPersonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const person = await storage.createPerson(parsed.data);
    res.status(201).json(person);
  });

  app.delete("/api/people/:id", async (req, res) => {
    const deleted = await storage.deletePerson(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========== Groups ==========
  app.get("/api/groups", async (_req, res) => {
    const groups = await storage.getGroups();
    res.json(groups);
  });

  app.get("/api/groups/:id", async (req, res) => {
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    res.json(group);
  });

  app.post("/api/groups", async (req, res) => {
    const parsed = insertGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const group = await storage.createGroup(parsed.data);
    res.status(201).json(group);
  });

  app.delete("/api/groups/:id", async (req, res) => {
    const deleted = await storage.deleteGroup(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========== Expenses ==========
  app.get("/api/expenses", async (_req, res) => {
    const expenses = await storage.getExpenses();
    res.json(expenses);
  });

  app.get("/api/expenses/group/:groupId", async (req, res) => {
    const expenses = await storage.getExpensesByGroup(req.params.groupId);
    res.json(expenses);
  });

  app.get("/api/expenses/friend/:personId", async (req, res) => {
    const expenses = await storage.getExpensesBetweenFriends(req.params.personId);
    res.json(expenses);
  });

  app.post("/api/expenses", async (req, res) => {
    const parsed = insertExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const expense = await storage.createExpense(parsed.data);
    res.status(201).json(expense);
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    const deleted = await storage.deleteExpense(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  return httpServer;
}
