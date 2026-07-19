# OnePosture

> OnePosture는 원본 [Pose Nudge](https://github.com/DDULDDUCK/pose-nudge)를 기반으로 만든 개인정보 보호 중심의 자세 관리 앱입니다. 원저작자 표시와 AGPL-3.0 기록을 유지합니다.

<p align="center">
  <img src="public/logo.png" alt="OnePosture 로고" width="150">
</p>

웹캠 영상은 기기 안에서만 분석합니다. 기본 모니터링, 시스템 알림, 상단 플로팅 알림은 무료입니다. OnePosture Pro는 화면 어둡게 알림을 잠금 해제하는 일회성 구매입니다.

## 주요 기능

- 여러 프레임과 사용자 기준 자세를 이용한 로컬 자세 분석
- 시스템 알림, 상단 플로팅 창, 소리, 화면 어둡게 알림
- 메뉴 막대에서 확인할 수 있는 모니터링 상태
- 영어, 한국어, 일본어, 중국어 간체/번체, 터키어 지원

## 다운로드 및 개발

- [최신 macOS 릴리스](https://github.com/makerjackie/pose-nudge/releases/latest)
- 개발 실행: `npm install && npm run tauri dev`
- 검증: `npm run check:localization && npm run build`

## 오픈 소스

데스크톱 앱은 [GNU AGPL v3](LICENSE)로 공개됩니다. One Apps Studio는 원본 Pose Nudge의 출처를 유지하며 앱 변경 사항을 이 저장소에 공개합니다. 결제 및 활성화 서비스를 제공하는 독립적인 01MVP 서버는 이 저장소에 포함되지 않습니다.

현재 화면과 자세한 기술 정보는 [영문 README](README.md)를 참고하세요.
