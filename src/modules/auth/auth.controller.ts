import type { NextFunction, Request, Response } from "express";
import {
  clearAuthCookies,
  getRefreshTokenFromCookies,
  setAuthCookies,
} from "../../common/utils/cookies.js";
import { authService } from "./auth.service.js";

export class AuthController {
  getInvitationPreview = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const preview = await authService.getInvitationPreview(
        req.query.token as string,
      );
      res.status(200).json({ invitation: preview });
    } catch (error) {
      next(error);
    }
  };

  setupInvitationPassword = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await authService.setupInvitationPassword({
        email: req.body.email,
        token: req.body.token,
        password: req.body.password,
        preferredName: req.body.preferredName,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  setupInvitationStudentAccounts = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await authService.setupInvitationStudentAccounts({
        setupId: req.body.setupId,
        students: req.body.students,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  chooseInvitation2faMethod = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await authService.chooseInvitation2faMethod({
        setupId: req.body.setupId,
        method: req.body.method,
        mobile: req.body.mobile,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  resendInvitation2faCode = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await authService.resendInvitation2faCode(req.body.setupId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  verifyInvitation2fa = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await authService.verifyInvitation2faAndActivate({
        setupId: req.body.setupId,
        code: req.body.code,
      });
      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

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
        identifier: req.body.identifier ?? req.body.email,
        password: req.body.password,
      });

      // 2FA is disabled for login for now.
      // if ("requires2fa" in result) {
      //   res.status(200).json(result);
      //   return;
      // }

      if (!("tokens" in result)) {
        res.status(200).json(result);
        return;
      }

      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

  verifyLogin2fa = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.verifyLogin2fa({
        challengeId: req.body.challengeId,
        code: req.body.code,
      });
      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };

  resendLogin2faCode = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await authService.resendLogin2faCode(req.body.challengeId);
      res.status(204).send();
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

  requestPasswordReset = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      await authService.requestPasswordReset({ email: req.body.email });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  getPasswordResetPreview = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const preview = await authService.getPasswordResetPreview(
        req.query.token as string,
      );
      res.status(200).json({ reset: preview });
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.resetPassword({
        token: req.body.token,
        password: req.body.password,
      });
      setAuthCookies(res, result.tokens);
      res.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
