# OnePosture

> **OnePosture 2.1:** a privacy-first posture companion for the OneApps family, built from the original [Pose Nudge](https://github.com/DDULDDUCK/pose-nudge) project. Original authorship and the full AGPL-3.0 history are preserved.

The app is open source under AGPL-3.0. Core posture monitoring, native notifications, and floating reminders are free. OnePosture Pro is a ¥39 / US$4.99 one-time purchase that unlocks the screen-dimming reminder on up to three devices. The first activation is online; afterward the signed entitlement works permanently offline. The independent 01MVP payment/license service is not part of this repository and communicates through a narrow HTTP API. See [the product and commercialization plan](docs/ONEPOSTURE_PRODUCT_PLAN.md).

<p align="center">
  <!-- 프로젝트 로고를 여기에 추가할 수 있습니다. -->
  <img src="public/logo.png" alt="OnePosture Logo" width="150">
  <br>
  <strong>AI-Powered Posture Correction Assistant - Real-time Posture Analysis and Improvement Guide</strong>
</p>

<p align="center">
  <!-- 소셜 및 커뮤니티 배지 -->
  <a href="https://github.com/makerjackie/pose-nudge/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/makerjackie/pose-nudge?style=for-the-badge&logo=github&color=gold"></a>
  <a href="https://github.com/makerjackie/pose-nudge/network/members"><img alt="GitHub Forks" src="https://img.shields.io/github/forks/makerjackie/pose-nudge?style=for-the-badge&logo=github&color=blueviolet"></a>
  <a href="https://github.com/dduldduck/pose-nudge/graphs/contributors"><img alt="All Contributors" src="https://img.shields.io/github/all-contributors/dduldduck/pose-nudge?style=for-the-badge&color=orange"></a>
  <br>
  <!-- 상태 및 릴리즈 배지 -->
  <a href="https://github.com/makerjackie/pose-nudge/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/makerjackie/pose-nudge?style=for-the-badge&color=brightgreen"></a>
  <a href="https://github.com/makerjackie/pose-nudge/releases"><img alt="GitHub Downloads" src="https://img.shields.io/github/downloads/makerjackie/pose-nudge/total?style=for-the-badge&logo=github&color=success"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/makerjackie/pose-nudge?style=for-the-badge&color=informational"></a>
  <br>
  <!-- 개발 활동 배지 -->
  <a href="https://github.com/makerjackie/pose-nudge/actions/workflows/release.yml"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/makerjackie/pose-nudge/release.yml?branch=main&style=for-the-badge&logo=githubactions"></a>
  <a href="https://github.com/makerjackie/pose-nudge/issues"><img alt="GitHub Issues" src="https://img.shields.io/github/issues/makerjackie/pose-nudge?style=for-the-badge&logo=github&color=red"></a>
  <a href="https://github.com/makerjackie/pose-nudge/pulls"><img alt="GitHub Pull Requests" src="https://img.shields.io/github/issues-pr/makerjackie/pose-nudge?style=for-the-badge&logo=github&color=yellow"></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="Language-English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge"></a>
  <a href="./README.ko.md"><img alt="Language-Korean" src="https://img.shields.io/badge/언어-한국어-blue?style=for-the-badge"></a>
  <a href="./README.tr.md"><img alt="Dil-Türkçe" src="https://img.shields.io/badge/Dil-Türkçe-blue?style=for-the-badge"></a>
  
</p>

---

## ✨ Key Features

OnePosture uses your webcam locally to analyze posture and delivers reminders through independent adapters, so a suppressed system banner does not make the app silently fail.

*   **📹 Real-time Posture Analysis**: Webcam-based real-time posture monitoring and AI-powered analysis
*   **🦴 Head Position & Shoulder Drift**: Uses calibrated, multi-frame signals and labels front-view depth limits honestly
*   **🔔 Reliable Reminders**: Native notifications, a top floating reminder, optional sound, and a screen-dimming adapter
*   **📊 Posture Score**: Displays current posture status scored from 0-100 points
*   **📈 Statistics Dashboard**: View posture improvement progress and session records
*   **⚙️ Personalized Settings**: Customizable notification intervals, sensitivity, and analysis frequency

---

## 🎥 Demo

### Screenshots

<!-- Add screenshots here -->
<p align="center">
  <img width="700" height="500" alt="스크린샷 2025-09-05 오후 5 02 27" src="https://github.com/user-attachments/assets/befe4249-1f40-47c8-b3d5-b5c1adece85f" />

  <img width="700" height="500" alt="스크린샷 2025-09-05 오후 5 03 50" src="https://github.com/user-attachments/assets/7718bc18-2e6a-4b3a-ae9a-f515a0a403bd" />
  
  <img width="630" height="145" alt="스크린샷 2025-09-05 오후 5 17 18" src="https://github.com/user-attachments/assets/263b3250-fbc5-47e8-ac73-a0466c7f7c1c" />

</p>

### Demo GIF

<!-- Add demo GIF here -->
<p align="center">
  <img src="demo/demo.gif" alt="Demo GIF" width="600">
</p>

---

## 📥 Download

Download the latest OnePosture release. The source remains available under AGPL-3.0.

| Operating System | Install Files | Download Link |
| :---: | :---: | :---: |
| 🍏 **macOS** | `.dmg` (Apple Silicon) | <a href="https://github.com/makerjackie/pose-nudge/releases/latest"><img src="https://img.shields.io/badge/Latest_Release-Download-brightgreen?style=flat-square" /></a> |

Windows and Linux users can build the AGPL source locally. Signed installers for those platforms will be listed here only after they have passed release acceptance.

---

## 👨‍💻 For Developers

If you're interested in contributing, follow this guide to set up the project locally.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://www.rust-lang.org/) (v1.70.0 or higher)
- [Git](https://git-scm.com/)

### Installation & Run

```bash
# 1. Clone the project
git clone https://github.com/makerjackie/pose-nudge.git
cd pose-nudge

# 2. Install Node.js dependencies
npm install

# 3. Run in development mode
npm run tauri dev
```

### Release Process

- `release-please` creates/updates release PRs from conventional commits on `main`.
- Merging the release PR updates versions in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and updates `CHANGELOG.md`.
- Public macOS builds are signed and notarized before upload.
- `.github/workflows/release.yml` can be dispatched manually for an existing tag after the required signing secrets are configured.

### Project Structure
```
pose-nudge/
├── src/                    # React Frontend
│   ├── components/         # UI Components
│   │   ├── ui/            # shadcn/ui Components
│   │   ├── Dashboard.tsx   # Dashboard
│   │   ├── WebcamCapture.tsx # Webcam Component
│   │   └── SettingsPage.tsx # Settings Page
│   ├── lib/               # Utility Functions
│   ├── locales/           # Internationalization Support
│   └── App.tsx            # Main App Component
├── src-tauri/             # Rust Backend
│   ├── src/
│   │   ├── main.rs        # Main Backend Logic
│   │   ├── pose_analysis.rs # Posture Analysis Engine
│   │   ├── reminder.rs    # Reminder timing state machine
│   │   └── licensing.rs   # Offline signed entitlement seam
│   ├── Cargo.toml         # Rust Dependencies
│   └── tauri.conf.json    # Tauri Configuration
├── models/                # AI Model Files
├── public/                # Static Files
└── locales/               # Localization Files
```

---

## 🛠️ Tech Stack

-   **Framework**: Tauri (Rust + React)
-   **Frontend**: React 19, TypeScript, Tailwind CSS 4
-   **Backend**: Rust, Tauri 2
-   **AI/ML**: YOLO11 Pose ONNX, processed locally on the device
-   **Build/Deployment**: Tauri CLI

---

## 🤝 Contributing

Contributions are always welcome! Whether it's bug reports, feature suggestions, or code contributions, we welcome all forms of participation. Please check out our [Contributing Guidelines](CONTRIBUTING.md) for more details.

---

## ✨ Contributors

Thanks to these wonderful people who have made this project better! ([emoji key](https://allcontributors.org/docs/en/emoji-key))

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/DDULDDUCK"><img src="https://avatars.githubusercontent.com/u/126528992?v=4?s=100" width="100px;" alt="Jaeseok Song"/><br /><sub><b>Jaeseok Song</b></sub></a><br /><a href="https://github.com/DDULDDUCK/pose-nudge/commits?author=DDULDDUCK" title="Code">💻</a> <a href="#maintenance-DDULDDUCK" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://adamdangoor.com"><img src="https://avatars.githubusercontent.com/u/797801?v=4?s=100" width="100px;" alt="Adam Dangoor"/><br /><sub><b>Adam Dangoor</b></sub></a><br /><a href="https://github.com/DDULDDUCK/pose-nudge/issues?q=author%3Aadamtheturtle" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Yodoma"><img src="https://avatars.githubusercontent.com/u/163729809?v=4?s=100" width="100px;" alt="Yodoma"/><br /><sub><b>Yodoma</b></sub></a><br /><a href="https://github.com/DDULDDUCK/pose-nudge/issues?q=author%3AYodoma" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://yusufyorunc.com.tr"><img src="https://avatars.githubusercontent.com/u/39492561?v=4?s=100" width="100px;" alt="Yusuf Yorunç"/><br /><sub><b>Yusuf Yorunç</b></sub></a><br /><a href="#translation-yusufyorunc" title="Translation">🌍</a></td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td align="center" size="13px" colspan="7">
        <img src="https://raw.githubusercontent.com/all-contributors/all-contributors-cli/1b8533af435da9854653492b1327a23a4dbd0a10/assets/logo-small.svg">
          <a href="https://all-contributors.js.org/docs/en/bot/usage">Add your contributions</a>
        </img>
      </td>
    </tr>
  </tfoot>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

---

## 📜 License

This project is licensed under the [AGPLv3 License](LICENSE).

## Contributors ✨

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
