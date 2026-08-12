import type { NextFunction, Request, Response } from "express";
import {
  clearAuthCookies,
  getRefreshTokenFromCookies,
  setAuthCookies,
} from "../../common/utils/cookies.js";
import { authService } from "./auth.service.js";

export class AuthController {
  acceptInvitation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.acceptInvitation({
        email: req.body.email,
        token: req.body.token,
        password: req.body.password,
        preferredName: req.body.preferredName,
      });

      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.login({
        email: req.body.email,
        password: req.body.password,
      });

      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = getRefreshTokenFromCookies(req.cookies);

      if (!refreshToken) {
        res.status(401).json({
          error: {
            code: "UNAUTHORIZED",
            message: "Refresh token missing",
          },
        });
        return;
      }

      const result = await authService.refresh(refreshToken);
      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = getRefreshTokenFromCookies(req.cookies);
      await authService.logout(refreshToken);
      clearAuthCookies(res);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authService.me(req.user!.id);
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
