import * as Sentry from "@sentry/node";
import {initialize} from "@zeus/observability";
export const observability=initialize(Sentry,{
  product:"till",dsn:process.env.ZEUS_DSN,
  environment:process.env.ZEUS_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  release:process.env.ZEUS_RELEASE ? "till@"+process.env.ZEUS_RELEASE : undefined,
  runtime:"node",target:process.env.ZEUS_TARGET,
});
