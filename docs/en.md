# Aduro

This integration controls **Aduro H1, H2, H3 and H5** hybrid pellet stoves
(H4 and H6 likely, not confirmed) from Gladys. It talks to the stove **locally**,
with the protocol of the Aduro Hybrid app: nothing goes through the Internet,
unless you turn the Aduro cloud relay on yourself.

## 1. Before you start

- The stove is connected to your Wi-Fi (set up with the Aduro Hybrid app).
- Note its **serial number** and **PIN code**: they are on the sticker of the
  stove, the ones the app asks for.
- Give the stove a **fixed IP address** (DHCP reservation on your router). It
  is required when the stove and Gladys are not on the same network.
- Gladys 5.1.0 or later.

## 2. Network and firewall

The stove listens on **UDP port 8483**. The integration sends its requests from
port **1901** and the stove answers to that port.

| Direction | Source            | Destination       | Protocol |
| --------- | ----------------- | ----------------- | -------- |
| Request   | Gladys, port 1901 | Stove, port 8483  | UDP      |
| Reply     | Stove, port 8483  | Gladys, port 1901 | UDP      |

- **Same network**: nothing to do.
- **Different networks (VLANs)**: allow the request from the IP address of
  Gladys to the stove's (UDP 8483). A stateful firewall lets the reply back. If
  yours blocks it, add the return rule (stove:8483 to Gladys:1901).
  Integrations run in a Docker container: seen from the firewall, the request
  comes from the IP address of the Gladys machine. Docker's NAT normally keeps
  the source port 1901.
- **Automatic search**: it uses a broadcast, which does not cross VLANs.
  Between two networks, enter the IP address of the stove.

## 3. Installation and configuration

1. Install the **Aduro** integration from the Gladys integration catalog.
2. Open **Configuration** and fill in:

| Field                     | Purpose                                                              | Default   |
| ------------------------- | -------------------------------------------------------------------- | --------- |
| Serial number             | Identifies the stove (sticker)                                       | —         |
| PIN code                  | Password of the stove (sticker)                                      | —         |
| IP address                | Fixed IP of the stove; empty = search on the local network           | empty     |
| Model                     | H1 to H6, used for the device name                                   | H2        |
| Use the Aduro cloud relay | See section 6                                                        | off       |
| Language of the states    | Language of the state texts and of the feature names of a new device | English   |
| Hopper capacity (kg)      | Content of a full hopper                                             | 9.5       |
| Low pellets alert (%)     | Level that fires "Stove pellets low"                                 | 10        |
| Automatic stop level (%)  | Stop level when "Stop at low pellets" is on                          | 5         |
| Smoke too hot (°C / s)    | Threshold and duration of the overheating alert                      | 370 / 30  |
| Wood fire dying (°C / s)  | Threshold and duration of the wood mode alert                        | 175 / 300 |
| Forced fan / auger (s)    | Longest run of the forced outputs                                    | 60 / 15   |

3. Save. The integration status turns "connected" once the stove answers.
4. In the **Devices** tab, add the stove and put it in a room.

Thresholds, capacity and language apply without a restart. Changing the serial
number, the PIN or the IP address restarts the connection.

## 4. The device

### Controls

| Feature             | Effect                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| Power               | Starts or stops the stove                                              |
| Heat level          | I, II or III; switches the stove to heat level mode                    |
| Target temperature  | 5 to 35 °C; switches the stove to temperature mode                     |
| Operation mode      | Heat level, temperature or wood                                        |
| Stop at low pellets | Stops the stove at the automatic stop level                            |
| Resume after wood   | In heat level mode, back to pellets when the wood fire dies (< 110 °C) |
| Forced fan          | Manual mode; stops after its duration or above 320 °C of smoke         |
| Forced auger        | Manual mode; stops after its duration                                  |
| Pellets refilled    | Sets the hopper back to full capacity                                  |
| Stove cleaned       | Resets "Burnt since cleaning"                                          |
| Resume pellets      | Leaves wood mode with the settings used before                         |
| Reset alarm         | Acknowledges the stove alarm                                           |

A change of heat level, target temperature or mode is followed until the stove
applies it: it is sent again up to three times, then abandoned after
100 seconds or when the stove is stopped from elsewhere (button, app). Changes
made from the Aduro app show up in Gladys.

### Readings

Temperatures (room, smoke, shaft), heat output (kW), carbon monoxide (ppm),
state and detail as text (with a countdown during ignition), consumption
(today, yesterday, month, year, total), pellets left (% and kg), burnt since
cleaning, operating times of the stove, the auger and the ignition.

Values are read every 45 seconds, every 5 seconds right after a command.
Consumption and network are read every 5 minutes.

### Pellets

The stove does not measure its hopper: the integration works out what is left
from the consumption the stove reports. To keep the level right:

1. set the **hopper capacity**;
2. press **Pellets refilled** after each full refill;
3. press **Stove cleaned** after a cleaning.

Counters and switches are kept across restarts.

## 5. Scenes

| Trigger                      | Variables                    |
| ---------------------------- | ---------------------------- |
| Stove smoke too hot          | temperature                  |
| Stove wood fire dying        | temperature                  |
| Stove pellets low            | level (%), pellets left (kg) |
| Stove stopped at low pellets | level (%), pellets left (kg) |
| Stove fault                  | state code, label            |

Each alert fires once. The smoke alert only re-arms once the temperature has
dropped 20 °C under the threshold.

Examples:

- **Refill reminder**: "Stove pellets low" → send a message "Only
  {{triggerEvent.data.remaining_kg}} kg of pellets left".
- **Fault**: "Stove fault" → send a message with
  `{{triggerEvent.data.state_label}}`.
- **Scheduled heating**: at 6:30 on weekdays → set the target temperature to
  21 °C; at 10 pm → power off.

## 6. Aduro cloud relay (optional)

Off by default. When you turn it on, a stove that cannot be reached locally is
reached through the Aduro relay (`apprelay20.stokercloud.dk`), as the app does
away from home. The device badge then shows "cloud", and the integration tries
the local network again every 15 minutes.

In that mode the serial number, the PIN code and the commands travel
**unencrypted** over the Internet (the protocol has no encryption). With the
relay on, turning "Prefer the local connection" off always goes through the
cloud.

## 7. Troubleshooting

| Symptom                     | What to check                                                      |
| --------------------------- | ------------------------------------------------------------------ |
| "The stove does not answer" | IP address, serial number and PIN, then the firewall (section 2)   |
| No device to add            | The device only shows up once the stove answered                   |
| "Unreachable" badge         | Three reads failed; the integration searches again by itself       |
| Unexpected "cloud" badge    | The relay is on and local fails: enter the IP address              |
| "Unknown state (NN)"        | State code not listed yet: note it and report it                   |
| Wrong pellet level          | Set the capacity, then press "Pellets refilled" with a full hopper |

The integration logs (integration supervision screen of Gladys) detail every
failure. The PIN code never appears in them.

## 8. Limits

- The pellet depletion prediction of the Home Assistant module is not ported.
- Gladys has no "kg" unit: weights are shown without a unit, the feature name
  says it.
- One stove per integration.

## Origin

Port of the Home Assistant module
[NewImproved/Aduro](https://github.com/NewImproved/Aduro) and of the
[pyduro](https://github.com/clementprevot/pyduro) library, both MIT-licensed.
