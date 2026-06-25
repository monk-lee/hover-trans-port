# HoverTransPort

언어: [English](../README.md) | 한국어

> 이 한국어 README는 빠른 이해를 위한 요약입니다. 릴리스, 보안, 개인정보, Native Host 세부 기준은 영어 원문 문서를 우선합니다.

![HoverTransPort inline translation preview](../docs/assets/github-social-preview.png)

HoverTransPort는 웹페이지에서 텍스트를 선택하거나 문장 위에 마우스를 올린 뒤 지정한 단축키를 누르면 번역을 페이지 안에 바로 보여주는 Chrome 확장 프로그램입니다. 별도 번역 탭으로 이동하지 않고, 읽던 위치에서 번역을 확인하는 흐름에 집중합니다.

Chrome Native Messaging으로 로컬 helper를 호출하고, helper는 사용자가 이미 설치하고 로그인한 AI CLI를 실행합니다. 지원 provider는 Codex CLI, Claude CLI, Gemini CLI, OpenCode CLI, Antigravity CLI입니다.

이 프로젝트는 OpenAI, Codex, Anthropic, Claude, Google, Gemini, OpenCode, Antigravity와 제휴, 보증, 후원을 받는 공식 제품이 아닙니다.

## 무엇을 하나요

| 흐름 | 결과 |
| --- | --- |
| 문단, 목록, 제목 위에 마우스를 올림 | 가리킨 블록을 페이지 안에 번역 |
| 특정 텍스트를 선택 | 선택 영역을 우선 번역 |
| 설정한 hotkey를 누름 | 요청한 순간에만 번역 실행 |
| 로컬 AI CLI provider 사용 | extension bundle 안에 provider 인증 정보를 넣지 않음 |

## 빠른 시작

1. [최신 GitHub Release](https://github.com/monk-lee/hover-trans-port/releases/latest)에서 `hover-trans-port-extension-v<version>.zip`을 다운로드합니다.
2. 압축을 해제한 뒤 `chrome://extensions`에서 Developer mode를 켜고 압축 해제한 폴더를 불러옵니다.
3. 사용 중인 플랫폼의 native host를 설치합니다.

   macOS/Linux:

   ```bash
   curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.sh
   bash install.sh install
   ```

   Windows PowerShell:

   ```powershell
   Invoke-WebRequest https://github.com/monk-lee/hover-trans-port/releases/latest/download/install.ps1 -OutFile install.ps1
   .\install.ps1 install
   ```

4. Options 페이지에서 `Check Native Host`와 `Check Provider`를 실행합니다.
5. provider, target language, trigger hotkey를 선택합니다.

각 provider CLI는 별도 전제 조건입니다. Options에서 선택하기 전에 Codex CLI, Claude CLI, Gemini CLI, OpenCode CLI, 또는 Antigravity CLI를 설치하고 인증해 두어야 합니다.

업데이트, 삭제, 스크립트 확인 후 설치, 진단, 문제 해결은 [Native Host Install](../docs/native-host-install.md)을 참고하세요.

## 사용

1. 읽기 가능한 텍스트가 있는 일반 웹페이지를 엽니다.
2. 텍스트를 선택하거나 문단, 목록, 제목 위에 마우스를 올립니다.
3. 설정한 trigger hotkey를 누릅니다. 기본값은 왼쪽 Control 키만 눌렀다가 떼는 방식입니다.
4. 페이지 안에 번역이 표시될 때까지 기다립니다.

Ctrl+C 또는 Ctrl+F 같은 일반 브라우저/편집 단축키는 trigger로 저장되지 않습니다.

## 현재 범위

| 현재 동작 | 아직 아님 |
| --- | --- |
| macOS, Linux, Windows와 Google Chrome | Chrome Web Store 설치 |
| `dist/` 폴더를 직접 불러오는 unpacked extension | browser store 배포 패키지 |
| Codex, Claude, Gemini, OpenCode, Antigravity CLI provider | 전체 페이지 자동 번역 |
| 마우스로 가리킨 읽기 가능한 블록과 선택 영역 번역 | PDF, iframe, OCR, 자막 번역 |
| 원문 안에 번역 표시, 로컬 SQLite 캐시, Options 진단 | hosted translation service |

## 개인정보와 보안 요약

HoverTransPort는 로컬 중심으로 동작하지만 완전한 오프라인 번역기는 아닙니다. 번역 요청 텍스트는 로컬 helper를 거쳐 설정된 provider CLI로 전달되며, 사용자의 CLI 계정, 로그인 상태, 실행 환경, 제공자 정책에 따라 외부 AI 서비스로 전송될 수 있습니다.

확장 프로그램과 helper는 API 키, OAuth 토큰, 브라우저 쿠키, 서비스 세션 토큰을 저장하지 않습니다. 캐시가 활성화되어 있으면 정규화된 원문과 번역문이 암호화되지 않은 로컬 SQLite에 저장될 수 있습니다.

민감한 콘텐츠에 사용하기 전에 [PRIVACY.md](../PRIVACY.md)와 [SECURITY.md](../SECURITY.md)를 읽어 주세요.

## Source에서 Build

```bash
pnpm install
pnpm build
```

이 저장소의 `dist/` 폴더를 `chrome://extensions`에서 불러옵니다.

개발할 때:

```bash
pnpm install
pnpm verify
pnpm dev
```

source에서 native host를 설치할 때:

```bash
pnpm helper:build:release
pnpm native:install
```

## 프로젝트 문서

- [Native Host Install](../docs/native-host-install.md)
- [Privacy](../PRIVACY.md)
- [Security](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)

## 라이선스

MIT. [LICENSE](../LICENSE)를 참고하세요.
