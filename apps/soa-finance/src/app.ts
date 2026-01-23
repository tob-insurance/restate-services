import { type Context, endpoint, service } from "@restatedev/restate-sdk";

const greeter = service({
  name: "Greeter",
  handlers: {
    greet: async (_ctx: Context, name: string) =>
      `Hello, ${name}! Welcome to SOA Finance.`,
  },
});

endpoint().bind(greeter).listen(9080);
