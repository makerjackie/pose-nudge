# Contributing to Pose Nudge

<p align="center">
  <a href="./CONTRIBUTING.md"><img alt="Language-English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge"></a>
  <a href="./CONTRIBUTING.tr.md"><img alt="Dil-Türkçe" src="https://img.shields.io/badge/Dil-Türkçe-blue?style=for-the-badge"></a>
</p>

First off, thank you for considering contributing to Pose Nudge! Your help is essential for keeping it great.

This document provides a set of guidelines for contributing to the project. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## 🤝 How Can I Contribute?

-   [🐛 Reporting Bugs](#-reporting-bugs)
-   [🚀 Suggesting Enhancements](#-suggesting-enhancements)
-   [💻 Your First Code Contribution](#-your-first-code-contribution)
-   [🔃 Pull Request Process](#-pull-request-process)

---

## 🐛 Reporting Bugs

Bugs are tracked as [GitHub issues](https://github.com/your-username/pose-nudge/issues). Before creating a bug report, please check the existing issues to see if the problem has already been reported.

When you are creating a bug report, please include as many details as possible. Fill out the required template, which will help us resolve issues faster.

-   **A clear and descriptive title** to identify the issue.
-   **Steps to reproduce** the behavior.
-   **Expected behavior**: What you expected to happen.
-   **Actual behavior**: What actually happened.
-   **Screenshots or videos** are extremely helpful for visual bugs.
-   **System information**:
    -   Operating System (e.g., Windows 11, macOS Sonoma)
    -   Pose Nudge Version (e.g., v1.0.0)

---

## 🚀 Suggesting Enhancements

We'd love to hear your ideas for improving Pose Nudge! If you have an idea for a new feature or an enhancement, please create an issue.

-   Use a **clear and descriptive title**.
-   Provide a **step-by-step description of the suggested enhancement** in as much detail as possible.
-   **Explain why this enhancement would be useful** to most Pose Nudge users.
-   If you've considered **alternatives**, let us know what they are.

---

## 💻 Your First Code Contribution

Unsure where to begin contributing? You can start by looking through these `good first issue` and `help wanted` issues:

-   **Good first issue** - issues which should only require a few lines of code, and a test or two.
-   **Help wanted** - issues which should be a bit more involved than `good first issue` issues.

### Development Setup

1.  **Fork & Clone the Repository**
    -   Fork this repository to your own GitHub account.
    -   Clone your forked repository to your local machine:
      ```bash
      git clone https://github.com/YOUR_USERNAME/pose-nudge.git
      cd pose-nudge
      ```

2.  **Add the `upstream` Remote**
    -   Add the original repository as a remote called `upstream` to keep your fork in sync.
      ```bash
      git remote add upstream https://github.com/your-username/pose-nudge.git
      ```

3.  **Install Dependencies & Set Up**
    -   Install all necessary packages and set up the environment.
      ```bash
      # Install Node.js dependencies
      npm install
      ```

4.  **Run the App in Development Mode**
    -   This will start the development server.
      ```bash
      npm run tauri dev
      ```

---

## 🔃 Pull Request Process

1.  **Create a New Branch**
    -   Before making any changes, create a new branch from `main`.
      ```bash
      # For a bug fix
      git checkout -b fix/brief-description-of-fix

      # For a new feature
      git checkout -b feat/brief-description-of-feature
      ```

2.  **Make Your Changes**
    -   Now, you can make your changes to the code.

3.  **Commit Your Changes**
    -   We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. This helps in generating automated changelogs.
        -   `feat`: A new feature.
        -   `fix`: A bug fix.
        -   `docs`: Documentation only changes.
        -   `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc).
        -   `refactor`: A code change that neither fixes a bug nor adds a feature.
        -   `test`: Adding missing tests or correcting existing tests.

      **Example:** `fix: Prevent crash when webcam is not available`

4.  **Push to Your Fork**
    -   Push your changes to your forked repository.
      ```bash
      git push origin fix/your-branch-name
      ```

5.  **Open a Pull Request**
    -   Go to your repository on GitHub and click the "Compare & pull request" button.
    -   Fill out the PR template.
        -   Link the issue that your PR is resolving (e.g., `Closes #123`).
        -   Provide a detailed description of the changes.

Once your PR is submitted, a project maintainer will review your code and provide feedback. Once all feedback is addressed, your contribution will be merged. Thank you for your hard work!


---

# Pose Nudge에 기여하기 (Contributing to Pose Nudge)

Pose Nudge 프로젝트에 관심을 가지고 기여해주셔서 진심으로 감사합니다! 여러분의 기여는 이 프로젝트를 더욱 훌륭하게 만듭니다.

이 문서는 프로젝트에 원활하게 기여할 수 있도록 돕기 위한 가이드라인입니다. 버그 리포트, 기능 제안, 코드 기여 등 모든 종류의 기여를 환영합니다.

프로젝트의 모든 참여자는 [Code of Conduct (행동 강령)](CODE_OF_CONDUCT.md)을 준수할 것을 약속합니다.

## 🤝 어떻게 기여할 수 있나요? (How Can I Contribute?)

-   [🐛 버그 리포트](#-버그-리포트-reporting-bugs)
-   [🚀 새로운 기능 제안](#-새로운-기능-제안-suggesting-enhancements)
-   [💻 코드 기여 (Pull Request)](#-코드-기여-pull-requests)

---

## 🐛 버그 리포트 (Reporting Bugs)

버그를 발견하셨다면, 먼저 [기존 이슈](https://github.com/your-username/pose-nudge/issues) 목록을 확인하여 중복된 리포트가 있는지 확인해주세요.

새로운 버그를 리포트할 때는 아래 정보를 최대한 자세하게 포함해주시면 문제 해결에 큰 도움이 됩니다.

-   **명확하고 설명적인 제목**: 어떤 버그인지 한눈에 알 수 있도록 작성해주세요.
-   **재현 단계 (Steps to Reproduce)**: 버그를 재현할 수 있는 구체적인 순서를 알려주세요.
-   **예상되는 결과 (Expected Behavior)**: 원래라면 어떻게 동작해야 하는지 설명해주세요.
-   **실제 결과 (Actual Behavior)**: 현재 어떻게 동작하고 있는지 설명해주세요.
-   **스크린샷 또는 동영상**: 시각적인 자료는 문제 파악에 매우 유용합니다.
-   **시스템 정보**:
    -   운영체제 (예: Windows 11, macOS Sonoma)
    -   Pose Nudge 버전 (예: v1.0.0)

---

## 🚀 새로운 기능 제안 (Suggesting Enhancements)

좋은 아이디어가 있으신가요? 언제든지 새로운 기능 제안을 환영합니다!

[새로운 이슈 생성](https://github.com/your-username/pose-nudge/issues/new) 시, "Feature request" 템플릿을 선택하고 아래 내용을 포함하여 제안해주세요.

-   **이 기능이 어떤 문제를 해결하나요?**: 기능의 필요성과 배경을 설명해주세요.
-   **제안하는 기능에 대한 상세한 설명**: 기능이 어떻게 동작하면 좋을지 구체적으로 설명해주세요.
-   **대안이 있다면?**: 고려해볼 만한 다른 방법이 있다면 함께 알려주세요.

---

## 💻 코드 기여 (Pull Requests)

코드 기여는 아래와 같은 절차로 진행됩니다.

### 1. 개발 환경 설정

1.  **저장소 포크(Fork) 및 클론(Clone)**
    -   이 저장소를 자신의 GitHub 계정으로 **Fork**하세요.
    -   Fork한 저장소를 로컬 컴퓨터로 **Clone**하세요.
      ```bash
      git clone https://github.com/YOUR_USERNAME/pose-nudge.git
      cd pose-nudge
      ```

2.  **원본 저장소(Upstream) 연결**
    -   원본 저장소의 변경 사항을 나중에 가져올 수 있도록 `upstream` 원격을 추가합니다.
      ```bash
      git remote add upstream https://github.com/your-username/pose-nudge.git
      ```

3.  **의존성 설치 및 실행**
    -   개발에 필요한 모든 패키지를 설치하고 환경을 설정합니다.
      ```bash
      # Node.js 의존성 설치
      npm install
      ```

### 2. 브랜치 생성 및 코드 수정

1.  **새로운 브랜치 생성**
    -   작업을 시작하기 전에, 항상 새로운 브랜치를 생성해주세요.
      ```bash
      # 버그 수정의 경우
      git checkout -b fix/brief-description-of-fix

      # 새로운 기능 추가의 경우
      git checkout -b feat/brief-description-of-feature
      ```

2.  **코드 수정**
    -   이제 자유롭게 코드를 수정하거나 새로운 기능을 추가합니다.

3.  **커밋 메시지**
    -   작업 내용은 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 규칙을 따라 작성해주시면 좋습니다.
        -   `feat`: 새로운 기능 추가
        -   `fix`: 버그 수정
        -   `docs`: 문서 수정
        -   `style`: 코드 포맷팅, 세미콜론 누락 등 (코드 로직 변경 없음)
        -   `refactor`: 코드 리팩토링
        -   `test`: 테스트 코드 추가/수정

      **예시:** `fix: Prevent crash when webcam is not available`

### 3. Pull Request 생성

1.  **변경사항 푸시(Push)**
    -   작업이 완료되면, 생성한 브랜치를 자신의 Fork 저장소로 푸시합니다.
      ```bash
      git push origin fix/your-branch-name
      ```

2.  **Pull Request (PR) 열기**
    -   GitHub의 Fork한 저장소 페이지로 이동하여 "Compare & pull request" 버튼을 클릭합니다.
    -   PR 제목과 본문을 양식에 맞게 작성해주세요.
        -   어떤 이슈를 해결하는지 명시합니다. (예: `Closes #123`)
        -   변경 사항에 대해 상세히 설명합니다.

PR이 생성되면, 프로젝트 관리자가 코드를 리뷰하고 피드백을 드릴 것입니다. 모든 과정이 순조롭게 진행되면 여러분의 소중한 코드가 프로젝트에 병합됩니다!
