import { applyRuntimeHeaders, shouldApplyRuntimeHeaders } from "./runtimeHeaders";

type RuntimeContext = {
  request: Request;
  next: () => Promise<Response>;
};

export async function onRequest(context: RuntimeContext): Promise<Response> {
  const response = await context.next();
  if (!shouldApplyRuntimeHeaders(context.request, response)) {
    return response;
  }
  return applyRuntimeHeaders(response);
}
