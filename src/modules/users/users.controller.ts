import type { NextFunction, Request, Response } from "express";
import {
  EmploymentType,
  UserRole,
  UserStatus,
} from "../../common/constants/roles.js";
import { usersService } from "./users.service.js";

export class UsersController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const people = await usersService.list({
        status: req.query.status as UserStatus | undefined,
        role: req.query.role as UserRole | undefined,
      });
      res.status(200).json({ people });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const person = await usersService.getById(req.params.id as string);
      res.status(200).json({ person });
    } catch (error) {
      next(error);
    }
  };

  invite = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await usersService.invite(
        {
          fullName: req.body.fullName,
          preferredName: req.body.preferredName,
          email: req.body.email,
          mobile: req.body.mobile,
          role: req.body.role as UserRole,
          employmentType: req.body.employmentType as EmploymentType | null,
          student: req.body.student,
          enrollment: req.body.enrollment,
          subjectIds: req.body.subjectIds,
        },
        req.user!.id,
      );

      res.status(201).json({
        person: result.person,
        pendingEnrollment: result.pendingEnrollment ?? null,
        // Temporary until email delivery exists
        invitationToken: result.invitationToken,
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const person = await usersService.update(req.params.id as string, {
        fullName: req.body.fullName,
        preferredName: req.body.preferredName,
        email: req.body.email,
        mobile: req.body.mobile,
        role: req.body.role,
        employmentType: req.body.employmentType,
        status: req.body.status,
        subjectIds: req.body.subjectIds,
      });
      res.status(200).json({ person });
    } catch (error) {
      next(error);
    }
  };

  resendInvitation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await usersService.resendInvitation(req.params.id as string);
      res.status(200).json({
        person: result.person,
        invitationToken: result.invitationToken,
      });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const person = await usersService.deactivate(
        req.params.id as string,
        req.user!.id,
      );
      res.status(200).json({ person });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await usersService.remove(req.params.id as string, req.user!.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const usersController = new UsersController();
