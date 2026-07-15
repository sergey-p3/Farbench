import type { NextFunction, Request, Response } from "express";
import { parse, serialize } from "cookie";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "farbench_session";

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuth(authToken: string) {
  const expected = tokenHash(authToken);

  function isValid(req: Request): boolean {
    const cookies = parse(req.headers.cookie ?? "");
    const actual = cookies[COOKIE_NAME];
    if (!actual) return false;
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  return {
    requireAuth(req: Request, res: Response, next: NextFunction) {
      if (isValid(req)) {
        next();
        return;
      }
      res.status(401).json({ error: "unauthorized" });
    },
    login(req: Request, res: Response) {
      if (req.body?.token !== authToken) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
      res.setHeader("Set-Cookie", serialize(COOKIE_NAME, expected, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      }));
      res.json({ ok: true });
    },
    isValid
  };
}
