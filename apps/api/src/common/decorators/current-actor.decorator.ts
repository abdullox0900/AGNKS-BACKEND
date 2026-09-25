import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor, ClientActor, StaffActor } from '@/common/types/actor';

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.actor as Actor;
});

export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientActor => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.actor as ClientActor;
});

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffActor => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.actor as StaffActor;
});
