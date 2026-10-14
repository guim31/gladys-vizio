// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The features already cover "turn on", "set the volume", "choose an input
// or a favorite app in the list". These actions take what a scene author
// types instead: any app of the SmartCast catalog by name ("Netflix",
// "Prime Video"), an input by name ("HDMI 2", the name set on the TV), and
// any key of the remote. They turn the device on first when needed, and
// return what they did for the next actions of the scene.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async open_app(hub, { fields = {} }) {
    const record = hub.target(fields.device || null);
    const app = await hub.openApp(record, String(fields.app ?? ''));
    return { app: app ? app.name : '' };
  },

  async select_input(hub, { fields = {} }) {
    const record = hub.target(fields.device || null);
    const input = await hub.selectInput(record, String(fields.input ?? ''));
    return { input: input.label };
  },

  async send_key(hub, { fields = {} }) {
    const record = hub.target(fields.device || null);
    const presses = await hub.sendKey(record, String(fields.key ?? ''), fields.repeat ?? 1);
    return { presses };
  },
};
