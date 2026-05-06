# Hover Trans Port

<p align="center">
  <img src="../docs/assets/hover-trans-port-icon.svg" alt="Hover Trans Port icon" width="72" height="72">
</p>

언어: [English](../README.md) | 한국어

> 이 한국어 README는 빠른 이해를 위한 요약입니다. 릴리스, 보안, 개인정보, Native Host 세부 기준은 영어 원문 문서를 우선합니다.

![Hover Trans Port inline translation preview](../docs/assets/hover-trans-port-preview.png)

Hover Trans Port는 웹페이지에서 텍스트를 선택하거나 마우스를 올린 뒤 지정한 단축키를 누르면 원문 근처에 번역을 보여주는 Chrome 확장 프로그램입니다. Chrome Native Messaging으로 로컬 helper를 호출하고, helper는 사용자가 이미 설치하고 로그인한 Codex CLI를 실행합니다.

이 프로젝트는 OpenAI 또는 Codex와 제휴, 보증, 후원을 받는 공식 제품이 아닙니다.

## 현재 범위

현재 동작하는 범위:

- macOS, Google Chrome, `dist/` 폴더를 직접 불러오는 개발자 미리보기 설치.
- Codex CLI provider.
- 선택 영역 우선 번역과 마우스로 가리킨 읽기 가능한 블록 번역.
- 원문 안에 번역 표시, 로컬 SQLite 캐시, Options 진단 기능.
- macOS native host용 script installer.

아직 지원하지 않는 범위:

- Chrome Web Store 설치.
- Windows/Linux Native Host 설치 가이드.
- Claude/Gemini 실행.
- 전체 페이지, 자동, PDF, iframe, OCR, 자막 번역.

## 설치

### 1. macOS Native Host 설치

alpha 경로는 GitHub Releases의 prebuilt native host를 `curl`로 설치하는 방식입니다.

```bash
curl -fsSL https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh | bash
```

이 installer는 현재 Mac 아키텍처에 맞는 helper를 다운로드하고 `checksums.txt`로 검증한 뒤, stable launcher와 Chrome Native Messaging manifest를 등록합니다. Codex CLI는 별도 전제 조건이므로 로컬에 설치되고 인증되어 있어야 합니다.

스크립트를 먼저 확인하고 실행하려면:

```bash
curl -fLO https://github.com/monk-lee/hover-trans-port/releases/latest/download/install-macos-native-host.sh
bash install-macos-native-host.sh install
```

자주 쓰는 명령:

```bash
bash install-macos-native-host.sh status
bash install-macos-native-host.sh update
bash install-macos-native-host.sh uninstall
```

### 2. Extension 불러오기

확장 프로그램 본체는 아직 unpacked developer-preview build로 설치합니다.

```bash
pnpm install
pnpm build
```

이후 `chrome://extensions`를 열고 Developer mode를 켠 다음 `Load unpacked`에서 이 저장소의 `dist/` 폴더를 선택합니다. Options에서 `Check Native Host`와 `Check Provider`를 모두 실행해 상태를 확인합니다.

개발자가 source에서 native host를 설치할 수도 있습니다.

```bash
pnpm helper:build:release
pnpm native:install
```

Native host 설치와 문제 해결의 상세 기준은 영어 문서 [Native Host Install](../docs/native-host-install.md)을 참고하세요.

## 사용

1. 읽기 가능한 텍스트가 있는 일반 웹페이지를 엽니다.
2. 텍스트를 선택하거나 문단, 목록, 제목 위에 마우스를 올립니다.
3. 필요하면 Options에서 `Target language`와 `Trigger hotkey`를 설정합니다.
4. 설정한 trigger hotkey를 누릅니다. 기본값은 왼쪽 Control 키만 눌렀다가 떼는 방식입니다.
5. 페이지 안에 번역이 표시될 때까지 기다립니다.

Ctrl+C 또는 Ctrl+F 같은 일반 브라우저/편집 단축키는 trigger로 저장되지 않습니다.

## 개인정보와 보안 요약

Hover Trans Port는 로컬 중심으로 동작하지만 완전한 오프라인 번역기는 아닙니다. 번역 요청 텍스트는 로컬 helper를 거쳐 설정된 provider CLI로 전달되며, 사용자의 CLI 계정, 로그인 상태, 실행 환경, 제공자 정책에 따라 외부 AI 서비스로 전송될 수 있습니다.

확장 프로그램과 helper는 API 키, OAuth 토큰, 브라우저 쿠키, 서비스 세션 토큰을 저장하지 않습니다. 캐시가 활성화되어 있으면 정규화된 원문과 번역문이 암호화되지 않은 로컬 SQLite에 저장될 수 있습니다.

민감하거나 기밀인 콘텐츠에 사용하기 전에 영어 원문 [PRIVACY.md](../PRIVACY.md)와 [SECURITY.md](../SECURITY.md)를 읽어 주세요.

## 개발

```bash
pnpm install
pnpm verify
pnpm dev
```

유용한 scripts:

- `pnpm build`: extension을 `dist/`에 build합니다.
- `pnpm verify`: 프로젝트 검증을 실행합니다.
- `pnpm helper:build:release`: 컴파일된 Native Messaging helper를 build합니다.
- `pnpm native:install`: 컴파일된 helper용 macOS Chrome Native Messaging manifest를 설치합니다.
- `pnpm native:uninstall`: native host manifest와 launcher를 제거합니다.
- `pnpm macos:script-installer:build`: macOS script installer release assets를 build합니다.

기여 전에는 영어 원문 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요.

## 라이선스

MIT. [LICENSE](../LICENSE)를 참고하세요.
