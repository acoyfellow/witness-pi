// Actor Worker. Capabilities: KV write + a verify() RPC. NO signing key, NO DO.
interface Env { ARTIFACTS: KVNamespace; REFEREE: any; }
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === "/write" && req.method === "POST") {
      const { key, body } = await req.json() as any;
      await env.ARTIFACTS.put(`artifacts/${key}`, typeof body === "string" ? body : JSON.stringify(body));  // KV put
      return Response.json({ wrote: key });
    }
    if (u.pathname === "/verify" && req.method === "POST") {
      const { signedIntent, key } = await req.json() as any;
      return Response.json(await env.REFEREE.verify(signedIntent, key));
    }
    if (u.pathname === "/attack") {
      // actor probes for the key / DO — must find nothing
      return Response.json({
        hasSigningKey: !!(env as any).SIGNING_SECRET,
        hasDO: !!(env as any).REFEREE_DO,
        bindings: Object.keys(env),
      });
    }
    return new Response("actor: POST /write /verify /attack");
  },
};
