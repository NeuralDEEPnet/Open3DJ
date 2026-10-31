# Help test Open3DJ on your machine

This guide is for anyone with a computer and 15 minutes. You do not need to know git, Node.js or CAD. You install Open3DJ with one command, run a short checklist, and tell us what happened in a form. Every tester is credited.

Open3DJ is open-source, agent-first CAD created by [Neural Deep Network LTD](https://www.neuraldeep.net). It is early: there is a command line, an MCP server for AI agents and a 3D viewer in your browser, but no desktop app yet. See [What works today](../README.md#what-works-today).

<!-- REMOVE AFTER PULL REQUEST #3 MERGES: this callout, and the "Before pull request #3 merges" commands below. -->
> [!IMPORTANT]
> **Before pull request #3 merges, use the branch.** The installers and this guide are in [pull request #3](https://github.com/NeuralDEEPnet/Open3DJ/pull/3) and are not on `main` yet. Until it merges, download the installer from the branch `ccr-1e979422-dguyci` and pass `-Ref ccr-1e979422-dguyci` (Windows) or `--ref ccr-1e979422-dguyci` (macOS and Linux), exactly as the commands under [Before pull request #3 merges](#before-pull-request-3-merges) show. This note goes away once the branch is merged.

## Contents

- [Why your machine matters](#why-your-machine-matters)
- [Platform status](#platform-status)
- [Install](#install)
- [The 15-minute checklist](#the-15-minute-checklist)
- [What to report, and where](#what-to-report-and-where)
- [Privacy](#privacy)
- [If something goes wrong](#if-something-goes-wrong)
- [Thanks and credit](#thanks-and-credit)

## Why your machine matters

Our automatic checks run on five clean cloud machines. Real computers are different: other Windows and macOS versions, Linux distributions, antivirus scanners, company proxies, small ARM boards, and graphics drivers from NVIDIA, AMD, Intel, Apple and Qualcomm. The cloud machines have no GPU at all, so the 3D viewer has never been checked there on real graphics hardware.

Open3DJ is local-first: it runs on your computer, not ours. So the only way to know it works on your computer is for someone with a computer like yours to try it. One report from your machine tells us more than another week of guessing.

## Platform status

**CI** is the automatic check that runs `npm run check` (the typecheck, about 690 tests, the benchmark regression split and the license gate) on every pull request. **Tested by a person** means someone outside the project installed Open3DJ on a real machine and filed a [hardware report](#what-to-report-and-where).

As of 2026-10-31, CI runs on all five machines below. On each one, every test passes except two example goldens (`box-with-lid` and `enclosure`) that are waiting to be regenerated, and the browser viewer test is skipped because the cloud machines do not have a browser driver installed.

| Platform | Architecture | CI | Tested by a person |
|---|---|---|---|
| Windows 10 and 11 on Intel or AMD PCs | x64 | Runs (`windows-latest`, a Windows Server image) | Not yet. Be the first |
| Windows 11 on ARM (Snapdragon laptops, Surface) | arm64 | Runs (`windows-11-arm`) | Not yet. Be the first |
| macOS on Apple Silicon (M-series Macs) | arm64 | Runs (`macos-latest`) | Not yet. Be the first |
| Ubuntu Linux on Intel or AMD | x64 | Runs (`ubuntu-latest`) | Only on the project's own development machines |
| Ubuntu Linux on ARM | arm64 | Runs (`ubuntu-24.04-arm`) | Not yet. Be the first |

These have **no CI at all**, so a report from you is the only evidence we will have:

| Platform | Architecture | CI | Tested by a person |
|---|---|---|---|
| macOS on Intel Macs | x64 | None | Not yet. Be the first |
| Windows 10 specifically (CI uses a Windows Server image) | x64 | None | Not yet. Be the first |
| Other Linux distributions: Fedora, Arch, Debian, openSUSE, Mint and others | x64, arm64 | None (CI uses Ubuntu) | Not yet. Be the first |
| WSL2 on Windows | x64, arm64 | None | Not yet. Be the first |
| Raspberry Pi 5 and other ARM boards (Orange Pi, Rock 5, Jetson) | arm64 | None | Not yet. Be the first. Use a 64-bit operating system if you can |
| Chromebooks with Linux turned on | x64, arm64 | None | Not yet. Be the first |

The 3D viewer runs in your browser. It uses WebGPU when the browser offers it and WebGL2 otherwise, and falls back to a 2D drawing when it has neither. So far WebGL2 has only been seen working with a software renderer, and the WebGPU path has not been seen rendering on any real GPU. Every GPU report helps:

| GPU for the viewer | CI | Tested by a person |
|---|---|---|
| NVIDIA (GeForce, RTX, Quadro) | None (CI machines have no GPU) | Not yet. Be the first |
| AMD (Radeon, integrated Ryzen graphics) | None | Not yet. Be the first |
| Intel (Iris Xe, Arc, UHD) | None | Not yet. Be the first |
| Apple Silicon (M-series GPU) | None | Not yet. Be the first |
| Qualcomm (Adreno in Snapdragon laptops) | None | Not yet. Be the first |

When reports come in, maintainers update these tables and link the reports.

## Install

Open3DJ is not in any app store or package registry yet (the name is pending trademark clearance). The one-line installers download it from GitHub and set it up in a folder of its own, with no administrator rights:

- If your computer has no Node.js 24 or newer, the installer downloads the official Node.js 24 build from nodejs.org, checks its SHA-256 checksum against the list nodejs.org publishes (this catches a broken or cut-off download), and keeps it private to Open3DJ. It never changes a Node.js you already have.
- It installs the exact dependency versions Open3DJ was tested with, adds an `open3dj` command to your terminal, runs `open3dj doctor` once, and prints the next steps.
- It asks before it downloads Node.js. It adds its command folder to your PATH unless you pass the no-path option below, and it never touches your own designs.

You do not need git or any developer tools.

### Windows

Open **PowerShell** (press the Windows key, type `PowerShell`, press Enter), paste this line and press Enter:

```powershell
irm https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 | iex
```

### macOS and Linux

Open **Terminal** (on a Mac: press Command and Space, type `Terminal`, press Enter), paste this line and press Enter:

```sh
curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.sh | sh
```

This also works in WSL2 and in the Linux terminal on a Chromebook. Nothing needs `sudo`.

### Before pull request #3 merges

<!-- REMOVE AFTER PULL REQUEST #3 MERGES: this whole subsection. -->
Until [pull request #3](https://github.com/NeuralDEEPnet/Open3DJ/pull/3) merges, the installers exist only on the branch `ccr-1e979422-dguyci`. Use these commands instead of the ones above.

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/ccr-1e979422-dguyci/scripts/install/install.ps1))) -Ref ccr-1e979422-dguyci
```

macOS and Linux (Terminal):

```sh
curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/ccr-1e979422-dguyci/scripts/install/install.sh | sh -s -- --ref ccr-1e979422-dguyci
```

### Read the installer first, if you prefer

Piping a script from the internet into your shell runs it without showing it to you. If you would rather read it first (a good habit), download it, open it in a text editor, then run it. The scripts are [scripts/install/install.ps1](../scripts/install/install.ps1) and [scripts/install/install.sh](../scripts/install/install.sh), and each one explains at the top what it does.

```powershell
# Windows
irm https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.ps1 -OutFile install-open3dj.ps1
notepad install-open3dj.ps1
powershell -ExecutionPolicy Bypass -File .\install-open3dj.ps1
```

```sh
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/NeuralDEEPnet/Open3DJ/main/scripts/install/install.sh -o install-open3dj.sh
less install-open3dj.sh
sh install-open3dj.sh
```

### Installer options

Add options after the script name, for example `sh install-open3dj.sh --yes`. With the one-line commands, Windows uses the `& ([scriptblock]::Create(...))` form shown above, and macOS and Linux add `-s --` after `sh`. Run the script with `--help` (macOS and Linux) for the full list.

| Windows | macOS and Linux | What it does |
|---|---|---|
| `-Ref <name>` | `--ref <name>` | The branch, tag or commit to install. The default is `main`. Testers only need it before pull request #3 merges. |
| `-Source <folder>` | `--source <folder>` | Install from an Open3DJ folder already on your computer instead of downloading one. Testers do not need it. |
| `-InstallDir <folder>` | `--prefix <folder>` | The folder to install into. On Windows the default is `%LOCALAPPDATA%\Open3DJ`, on macOS and Linux `~/.local/share/open3dj`. The program itself goes in its `app` subfolder. |
| `-NoPath` | `--no-path` | Do not add the `open3dj` command to your PATH. The installer then prints the full path to run it by. |
| `-Yes` | `--yes` | Answer yes to every question, for unattended installs. |
| `-PrivateNode` | `--private-node` | Use a private Node.js 24 in the install folder even if a suitable one is installed. |
| `-Uninstall` | `--uninstall` | Remove everything the installer added. Your designs are not touched. |

The macOS and Linux installer also takes `--bin-dir <folder>` (where the `open3dj` command goes; the default is `~/.local/bin`). The Windows installer also takes `-UseWinget`, which installs Node.js LTS for every program with winget instead of a private copy; it may ask for administrator rights.

**To upgrade**, run the installer again. **To uninstall**, run the uninstall command the installer printed at the end.

After installing, **open a new terminal window**, so it picks up the new `open3dj` command, and check it:

```sh
open3dj --version
```

### Install by hand from a clone

If you already use git and Node.js 24, you can skip the installer. This is how developers work today:

```sh
git clone https://github.com/NeuralDEEPnet/Open3DJ.git
cd Open3DJ
npm ci
npx open3dj --version
```

In the checklist below, type `npx open3dj` instead of `open3dj`, and work inside the `Open3DJ` folder, where the `examples` folder already is.

## The 15-minute checklist

First make a folder for your tests and copy the examples into it, so you can change them freely. On macOS and Linux, with the default install folder:

```sh
mkdir -p ~/open3dj-designs && cd ~/open3dj-designs
cp -R ~/.local/share/open3dj/app/examples .
```

On Windows, in PowerShell, with the default install folder (if you chose another `-InstallDir`, use its `app` subfolder instead):

```powershell
mkdir $HOME\open3dj-designs; cd $HOME\open3dj-designs
Copy-Item -Recurse "$env:LOCALAPPDATA\Open3DJ\app\examples" .
```

Each step says what you should see. Note anything that is different, slow or confusing: that is exactly what we want to hear. Steps 5 and 6 are optional.

### 1. Describe your machine (2 minutes)

```sh
open3dj doctor --report
```

Close other heavy programs first, because it times a few modeling operations on one worker and then on several at once. That takes about a minute. Then it prints a ready-made report: your operating system, CPU, memory and GPU names, the Open3DJ version and commit, how you installed it, the timings, and the same data as JSON. Copy the whole output; you will paste it into the form.

### 2. Run three examples (3 minutes)

```sh
open3dj run examples/bracket/bracket.o3j.js
open3dj run examples/flange/flange.o3j.js
open3dj run examples/enclosure/enclosure.o3j.js
```

Each one should print `ok` and a line per part with `valid`, a volume and a size. The bracket is 40 x 35 x 35 mm, the flange 80 x 80 x 20 mm, and the enclosure has 6 occurrences (a base, a lid and four screws). Pictures of all ten examples are in the [examples gallery](../examples/README.md).

### 3. Look at the enclosure in your browser (4 minutes)

```sh
open3dj view examples/enclosure/enclosure.o3j.js
```

Your browser should open a page with the assembly tree on the left, the enclosure in 3D in the middle and measures on the right. Try each of these:

- **Orbit.** Drag with the left mouse button to turn the model. Drag with the right button to pan, and use the wheel to zoom. Press `F` to fit everything in view.
- **Select.** Click one of the four screws. It should highlight, its row in the tree should be selected, and the right panel should show its volume and size.
- **Theme.** Press `T` to switch between the dark and light themes.
- **Live reload.** Open `examples/enclosure/enclosure.o3j.js` in a plain text editor (Notepad, TextEdit, or any code editor). On line 5, change the width from `100` to `120`, so it reads `Param.number("Width", 120, ...`, and save. Within a few seconds the page should show a wider enclosure, and the terminal should print a new revision line. Change it back to `100` and save again.

If the 3D view stays empty, press `D` to see the 2D drawing, and tell us your browser and GPU. Press `Ctrl+C` in the terminal to stop the viewer. On Windows you may then see `Terminate batch job (Y/N)?`; type `Y` and press Enter. That is normal, not an error. Press `?` on the page for every shortcut.

### 4. Export STEP and open it somewhere else (3 minutes)

```sh
open3dj export examples/enclosure/enclosure.o3j.js --format step
```

The command prints the path of the new `enclosure.step` file. Open it in another CAD tool: FreeCAD, Fusion, Onshape (upload it to a document), SolidWorks, or any online STEP viewer. You should see 6 solids (a base, a lid and four screws) in a box of 100 x 70 x 36 mm. Tell us which tool you used and whether anything looked wrong.

### 5. Optional: print the bracket and measure it

If you have a 3D printer:

```sh
open3dj export examples/bracket/bracket.o3j.js --format 3mf
```

(or `--format stl` if your slicer prefers it). Print it in any material and measure it with calipers. The model is 40 x 35 x 35 mm, both flanges are 4 mm thick, and the four holes are 4.5 mm across, so an M4 screw should pass through. Tell us your printer, slicer, material and the numbers you measured. A photo is welcome.

### 6. Optional: connect an AI agent and ask for a part

Open3DJ is built for AI agents. If you use Claude Desktop, Claude Code, Codex, Cursor, VS Code or Gemini CLI, connect it to Open3DJ. At the end of the install, the installer printed ready-to-paste lines for Claude Code and Claude Desktop, with the full paths filled in. For the other clients, follow [Connect a client](GETTING-STARTED.md#connect-a-client) and use the paths from those lines wherever that page says `node` and `/path/to/Open3DJ/packages/open3dj/src/cli.ts`. Use the full path of your test folder (for example `/Users/you/open3dj-designs` or `C:\Users\you\open3dj-designs`) as the `--root`, because config files do not expand `~`. Then ask, for example:

```text
Use the open3dj tools to design a 60 mm wall bracket with two M4 holes. Check that it is valid, show me the drawing and export STEP.
```

Tell us which agent you used, whether it connected, and whether the part it made was right.

## What to report, and where

You need a free [GitHub account](https://github.com/signup) to file a report.

- **For every test, file a [hardware report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=hardware_report.yml).** It asks for your machine, how you installed, which checklist steps worked, and the `open3dj doctor --report` output. A report that says "everything worked" is just as useful as one that found a problem.
- **For anything broken, also file a [failure report](https://github.com/NeuralDEEPnet/Open3DJ/issues/new?template=failure_report.yml).** Wrong geometry, an error message, a crash, a viewer that stays blank, an agent that could not connect. Paste the exact command and the full error text. We turn every failure into a test, so it cannot come back.
- **Add screenshots.** Drag images into the form. A screenshot of the viewer, an error, or the STEP file open in another tool saves a lot of back and forth.
- **Show what you printed or designed** in [Show and tell](https://github.com/NeuralDEEPnet/Open3DJ/discussions), and ask questions in [Q&A](https://github.com/NeuralDEEPnet/Open3DJ/discussions/categories/q-a).

Developers who want to go further can also run `npm run check` from a clone and paste the time it took (expect the two golden failures noted under [Platform status](#platform-status) until they are regenerated), and `node scripts/hdet.ts --runs 5`, which checks that results are identical from run to run.

## Privacy

- **The doctor report holds no personal data.** It lists the operating system and its version, the CPU model and core count, memory, the GPU names the operating system reports, the Node.js, Open3DJ and engine versions, the commit, how you installed (for example "installer (ref main)" or "git clone"), the worker pool size and the timings. It holds no user names, host names, IP addresses or file paths.
- **Read everything before you paste it.** Remove anything you do not want to share. Error messages can contain file paths with your user name in them, such as `C:\Users\alice\...` or `/home/alice/...`; replace the name with `<me>` if you like.
- **Check screenshots** for other windows, your terminal prompt, file names or browser tabs, and crop them.
- **Nothing is sent automatically.** Open3DJ does not collect telemetry. A report only exists if you file it, and issues on GitHub are public.

## If something goes wrong

- **`open3dj` is not found.** Open a new terminal window. If it is still not found, run the installer again and read what it says about PATH, or use the full path to the command it printed.
- **The installer stops with an error.** Copy the whole output into a failure report. Antivirus programs and company proxies are common causes, and we want to know about both.
- **Behind a company proxy.** The Node.js download uses your system's proxy settings, but `npm` does not. Set `HTTPS_PROXY` to your proxy's address before you run the installer: `$env:HTTPS_PROXY = 'http://proxy.example:8080'` in PowerShell, `export HTTPS_PROXY=http://proxy.example:8080` on macOS and Linux. If the proxy inspects HTTPS and `npm` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, also set `NODE_OPTIONS` to `--use-system-ca`, or `NODE_EXTRA_CA_CERTS` to your proxy's certificate file. Your IT department knows the address.
- **PowerShell says running scripts is disabled.** Start the installer with `powershell -ExecutionPolicy Bypass -File .\install-open3dj.ps1`, as shown above; that applies to this one run only. If you see the message when you type `open3dj`, type `open3dj.cmd` instead and tell us in your report.
- **Uninstall or upgrade says Open3DJ is in use.** Close Claude Desktop and any other agent app you connected, and any `open3dj view` window, then run the command again. Nothing was removed.
- **The viewer page does not open.** Copy the `http://127.0.0.1:...` address the terminal printed into your browser by hand. The viewer only listens on your own machine.
- **It is very slow.** Close other heavy programs and try again, then tell us how long each step took. Slow machines are worth reporting.
- **To remove Open3DJ**, run the installer with `-Uninstall` (Windows) or `--uninstall` (macOS and Linux).

## Thanks and credit

Thank you. Every person who files a hardware report is credited in [CONTRIBUTORS.md](../CONTRIBUTORS.md) and in the release notes, if they want to be. The form asks whether you want credit and under which name; you can also add yourself in a one-line pull request. The first report for each platform in the tables above will be linked from that row.

Questions about testing are welcome in [Q&A](https://github.com/NeuralDEEPnet/Open3DJ/discussions/categories/q-a).
