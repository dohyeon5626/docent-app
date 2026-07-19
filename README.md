# Docent<img src="https://github.com/user-attachments/assets/a32cc0f0-de76-4fba-bd9c-0605bef016a1" align=left width=100>

![GitHub License](https://img.shields.io/github/license/dohyeon5626/docent-app?style=flat&color=green) ![GitHub Tag](https://img.shields.io/github/v/tag/dohyeon5626/docent-app?style=flat&color=green`) ![Platform](https://img.shields.io/badge/platform-macOS-blue?style=flat)
<br/><br/>

[Download](https://docent.dohyeon5626.com)
> ⚠️  If macOS blocks the first launch, right-click the app → Open (or allow it in System Settings → Privacy & Security).  

<img width="100%" align=center alt="preview" src="https://github.com/user-attachments/assets/aa18ed35-0b9a-458d-bd96-cd2c9649e143">
<br/><br/>

Docent is a macOS desktop app that turns your documents (PDF, Word, or Pages) into a study guide. Open one and Claude writes a step-by-step summary alongside the original — every sentence linked back to the page it came from.<br/>
- **AI-generated study guide**: Claude analyzes the document and writes one continuous summary, broken into steps ordered by what's easiest to learn first, not by page order.
- **Two-way page sync**: click a line in the summary to jump the PDF to that page (spotlighted), or click a page in the PDF to scroll to its summary section.
- **Ask & merge**: ask a question about what you're reading, then fold the answer directly into the summary so the document keeps improving as you study.
- **Per-project language & detail level**: brief/standard/detailed summaries in Korean or English — regenerate the whole document, or just one section that didn't come out right.
- **Export to PDF**: save the finished summary as a standalone PDF, styled to match the in-app reading view.

> Powered by the local [Claude Code CLI](https://code.claude.com/docs/en/setup) — no Anthropic API key required.

## Installing on macOS

The app isn't notarized with a paid Apple Developer certificate yet, so macOS will refuse to open it the first time. To run it:
1. Right-click (or Control-click) `Docent.app` and choose **Open**, then click **Open** in the dialog that appears.
2. If that doesn't work: open **System Settings → Privacy & Security**, scroll down to the message that `Docent.app` was blocked, and click **Open Anyway**.
