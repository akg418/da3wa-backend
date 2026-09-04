import type { FastifyJWT } from '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      username?: string;
      email?: string;
    };
    user: {
      sub: string;
      username?: string;
      email?: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }
}
