export default {
  async fetch(): Promise<Response> {
    return new Response("uk-rent-lookup worker (scaffold)", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
