import { Router } from "express";
import { AppDataSource } from "../config/data-source.js";
import { User } from "../entities/User.js";

const usersRouter = Router();

usersRouter.get("/", async (_req, res) => {
  const users = await AppDataSource.getRepository(User).find({
    order: { createdAt: "DESC" },
  });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const { name, email } = req.body as { name?: string; email?: string };

  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }

  const repo = AppDataSource.getRepository(User);
  const user = repo.create({ name: name.trim(), email: email.trim() });
  const saved = await repo.save(user);
  res.status(201).json(saved);
});

export default usersRouter;
