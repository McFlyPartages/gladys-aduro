# Aduro

This integration controls **Aduro H1, H2, H3 and H5** hybrid pellet stoves
(H4 and H6 likely, not confirmed) from Gladys, locally, with the same protocol
as the Aduro Hybrid app.

## Before you start

- The stove must be connected to your Wi-Fi (through the Aduro Hybrid app).
- Note its **serial number** and **PIN code**: they are on the sticker of the
  stove and are the ones the app asks for.
- Preferably give the stove a **fixed IP address** (DHCP reservation on your
  router).

## Configuration

1. In Gladys, open **Integrations → Aduro → Configuration**.
2. Enter the serial number and the PIN code.
3. **IP address**: leave it empty to let Gladys look for the stove on the local
   network. When the stove is on another network (VLAN) than Gladys, the search
   cannot find it: enter its IP address.
4. Pick the model and the language of the state texts.
5. Save, then open the **Devices** tab and add the stove.

### Aduro cloud relay

When the stove cannot be reached locally, the integration goes through the
Aduro relay (`apprelay20.stokercloud.dk`), as the app does. The device badge
then shows "cloud". In that mode the serial number and the PIN code travel
**unencrypted** over the Internet: turn "Use the Aduro cloud relay" off if you
do not want that. Turning "Prefer the local connection" off goes through the
relay straight away.

### Network

The stove listens on UDP port **8483**. If a firewall stands between Gladys and
the stove, allow UDP from Gladys to the stove on that port (the replies come
back through the same session).

## What you get

**Controls**: on/off, heat level (I, II, III), target temperature (5 to
35 °C), operation mode (heat level, temperature, wood). Setting a heat level or
a temperature switches the stove to the matching mode. When the stove does not
apply a change, it is sent again up to three times.

**Readings**: room, smoke and shaft temperatures, heat output, carbon
monoxide, state and detail (with a countdown during ignition), consumption
(today, yesterday, month, year, total), operating times.

**Pellets**: the stove does not measure its hopper. The integration computes
what is left from the consumption: set the hopper capacity in the
configuration and press **Pellets refilled** after each refill, **Stove
cleaned** after a cleaning.

**Switches**:

- **Stop at low pellets**: stops the stove at the automatic stop level;
- **Resume after wood**: in heat level mode, goes back to pellets when the wood
  fire dies (smoke under 110 °C);
- **Forced fan** and **Forced auger**: manual mode, stopped after the
  configured duration (and above 320 °C of smoke for the fan).

**Buttons**: pellets refilled, stove cleaned, resume pellets, reset alarm.

## Scenes

Available triggers: **smoke too hot**, **wood fire dying** (thresholds and
durations in the configuration), **pellets low**, **stopped at low pellets**
and **stove fault** (code and label of the state). Use them, for example, to
send a message when the stove stops.

## Limits

- The pellet depletion prediction of the Home Assistant module is not ported.
- Weights are shown without a unit (Gladys has no "kg" unit): the feature name
  says it.

## Origin

Port of the Home Assistant module
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) and of the
[pyduro](https://github.com/clementprevot/pyduro) library, both MIT-licensed.
