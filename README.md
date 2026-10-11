<p align="center">
  <img src="app/src-tauri/icons/128x128.png" width="96" height="96" alt="Layp icon">
</p>

<h1 align="center">Layp</h1>

<p align="center">
  A local desktop planner for Linux.<br>
  Tasks, a calendar, and a day record in one SQLite file.
</p>

<p align="center">
  <img src="docs/screenshots/today.png" width="880" alt="Today, with the day's tasks and the day record">
</p>

Layp is an installed program with its own window. There is no account and no cloud server. Tasks stay in one SQLite file on this computer. A phone on the same Wi-Fi can keep its own copy. A backup is a copy of the desktop file.

## Screens

<p align="center">
  <img src="docs/screenshots/calendar.png" width="880" alt="Calendar">
</p>

<p align="center">
  <img src="docs/screenshots/year.png" width="880" alt="Year">
</p>

The sidebar opens on Today, Inbox, Upcoming, and Calendar. Lists and folders sit under those. More holds the rest:

| Screen | What it is for |
| --- | --- |
| Today | Tasks for the day, plus the diary, sleep, and workout line |
| Inbox | Tasks that do not have a list yet |
| Upcoming | What is scheduled next |
| Calendar | The month, with tasks on their days |
| Board | One list as columns |
| Matrix | Important and urgent |
| Timeline | The week as columns |
| Month | The month spread and the day page |
| Year | The year, a day at a time |
| Trackers | Checks and counts you keep |
| Hobbies | Time spent, not a daily debt |
| Focus | A work timer and a break |
| Stats | Bars, a line, or a notebook, for 7, 28, or 365 days |
| Settings | Theme, clock, tray, backup, and About |

Type a task in the sidebar field. `call mom tomorrow 9am` sets the title, the day, and the time. The question mark next to the field lists the words Layp understands.

## Install

The desktop package and the phone APK are attached to the [0.2.0 release](https://github.com/dj-secq/layp/releases/tag/v0.2.0).

```sh
curl -LO https://github.com/dj-secq/layp/releases/download/v0.2.0/Layp_0.2.0_amd64.deb
sudo apt install ./Layp_0.2.0_amd64.deb
```

Installing it adds Layp to the app menu. The package is section `utils`, priority `optional`. The desktop entry is a Productivity app. Its keywords are tasks, planner, calendar, journal, todo, and focus.

Build the package from this repo:

```sh
cd app
npm install
npm run tauri build
```

The package is written to `app/src-tauri/target/release/bundle/deb/`. The AppImage is under `bundle/appimage/`.

## Develop

Node 22 and a Rust toolchain are required, plus the WebKitGTK and GTK libraries Tauri uses on Linux. Install from `app/`, `phone/`, or `shared/`. The repo root is not a package.

```sh
cd app
npm install
npm test
npm run tauri dev
```

`npm run tauri dev` opens the Layp window.

## Phone

The phone APK on the 0.2.0 release is an arm64 Android package. Install it from the file manager. It is signed with its own key, so a development build of Layp has to be uninstalled first.

The phone project is in `phone/`. `npx expo start` is the development build, for a phone on the same Wi-Fi. It is not a store download.

```sh
cd phone
npm install
npm test
npx expo start
```

`android/` and `ios/` are generated and stay out of git. From `phone/`, `npm run android` rebuilds the Android project.

## License

[MIT](LICENSE)
