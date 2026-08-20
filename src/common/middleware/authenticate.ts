import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../../config/data-source.js";
import { User } from "../../entities/User.js";
import { UserRole } from "../constants/roles.js";
import { AppError } from "../errors/AppError.js";
import { getAccessTokenFromCookies } from "../utils/cookies.js";
import { verifyAccessToken } from "../utils/jwt.js";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

export const CONSOLE_ROLES = [UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF];

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = getAccessTokenFromCookies(req.cookies);

    if (!token) {
      throw new AppError(401, "Authentication required", "UNAUTHORIZED");
    }

    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(401, "Invalid or expired access token", "UNAUTHORIZED"));
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new AppError(401, "Authentication required", "UNAUTHORIZED"));
      return;
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      next(new AppError(403, "Insufficient permissions", "FORBIDDEN"));
      return;
    }

    next();
  };
}

export function authorizeAdminModule(...moduleIds: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "UNAUTHORIZED");
      }
      if (req.user.role === UserRole.SUPER_ADMIN) {
        next();
        return;
      }
      if (req.user.role !== UserRole.OFFICE_STAFF) {
        throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
      }
      const user = await AppDataSource.getRepository(User).findOne({
        where: { id: req.user.id },
        select: { id: true, modulePermissions: true },
      });
      const permissions = user?.modulePermissions ?? [];
      const allowed = moduleIds.some((moduleId) =>
        permissions.includes(moduleId),
      );
      if (!allowed) {
        throw new AppError(
          403,
          "You do not have access to this module",
          "MODULE_FORBIDDEN",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
