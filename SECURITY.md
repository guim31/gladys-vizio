# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in particular:

- **What is stored**: `/data/vizio-state.json` (file mode 0600) holds the pairing identity of this
  Gladys (`gladys-` and 8 random hex digits), and for each device its address, port, model, inputs
  and, for a TV, the **auth token** the TV gave at pairing. Anyone who reads this token can control
  the TV on the local network until the TV is reset or paired again. The token is never written to
  the logs, the device params or the messages shown in Gladys.
- **Secrets**: the configuration holds none. The PIN typed in the "Enter the PIN" action is used
  once and never logged or stored.
- **Network**: the integration talks HTTPS to the SmartCast devices only (ports 7345 and 9000), on
  the addresses found by the core's mDNS discovery or typed by the user. SmartCast devices use a
  self-signed certificate, so it is not verified (as in every SmartCast client): someone able to
  impersonate a TV's address on the LAN could receive its token. No other host is contacted.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the VIZIO devices and their firmware.
