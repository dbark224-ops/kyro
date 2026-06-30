export default class VapiNativeStub {
  constructor(_publicKey: string) {}

  on() {
    return this;
  }

  send() {}

  async start() {
    throw new Error(
      "Voice calls cannot run inside Expo Go. Use a development build, simulator build, or TestFlight build.",
    );
  }

  stop() {}
}
