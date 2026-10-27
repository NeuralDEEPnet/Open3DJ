# Gap 3: Tier B Python pins (CadQuery / build123d vs OCP 8)

Checked 2026-10-27 against PyPI JSON metadata, upstream git history and uv 0.11.32 dry-run resolution. No package code was executed. The wheels were only downloaded and compared as zip archives.

## Short answer

- **build123d 0.13.0** (2026-09-21) is the **only released** version that depends on OCP 8: `cadquery-ocp-novtk >=8.0,<8.1`. Version 0.12.0 (2026-09-18) and 0.11.x still pin `cadquery-ocp-novtk >=7.9,<8.0`. The 0.13.0 release notes say it is "otherwise identical to build123d v0.12.0" and only moves the kernel to OCP 8.0.1.0.0.
- **No released CadQuery depends on OCP 8.** CadQuery 2.8.0 (2026-06-21, still the latest on PyPI, with no 2.9 pre-release) pins `cadquery-ocp >=7.9.3.1,<8.0`. CadQuery `master` (setup.py version `2.9.0dev`) moved to OCP 8 in three steps: #2076 on 2026-09-04, #2088 on 2026-09-05, and #2099 on 2026-10-07, which pins `cadquery-ocp==8.0.1.1`. That code is unreleased.
- **CadQuery 2.8.0 and build123d 0.13.0 cannot share one uv environment.** uv reports "build123d>=0.13.0 and cadquery>=2.8.0 are incompatible". Both OCP wheels pin an exact `cadquery-ocp-proxy==<own version>`, so 7.9.3.x and 8.0.1.x cannot coexist.
- **Forcing CadQuery 2.8.0 onto OCP 8 is not a real option.** A uv override resolves, but OCP 8 renamed the collection bindings. CadQuery needed source changes to move from `OCP.TColgp`/`OCP.TopTools`/`TColStd` to `OCP.collections` (for example `Array1_gp_Vec`, `HSequence_TopoDS_Shape`), from `LProp3d` to `LProp`, and to drop GCE2d. These changes are in #2076, so 2.8.0 code does not match the OCP 8 API.
- **Working single-kernel combinations today:**
  1. `build123d==0.13.0` + `cadquery-ocp-novtk==8.0.1.1.0` alone: OCCT 8.0.1, no VTK.
  2. `build123d==0.12.0` + `cadquery==2.8.0`: both released, resolve to OCP **7.9.3.1.1** (OCCT 7.9.3).
  3. `build123d==0.13.0` + CadQuery master pinned to a git SHA at or after `9a6a705`: resolves to OCP **8.0.1.1.0** on linux-x86_64, win-amd64 and macos-arm64 (py3.12/3.13). It only becomes clean with the fix described next.

## The VTK / no-VTK trap (applies to options 2 and 3)

build123d depends on **`cadquery-ocp-novtk`** and CadQuery depends on **`cadquery-ocp`**, which pulls in `vtk==9.6.2`. These are two separate distributions, and uv installs both. I downloaded both cp313 manylinux 8.0.1.1.0 wheels and compared them:

- The wheels share 333 paths under the top-level `OCP/` package.
- Exactly one shared path has different content: the main extension `OCP/OCP.cpython-313-x86_64-linux-gnu.so`, which is 159.4 MB in the VTK build and 154.2 MB in the no-VTK build.
- The VTK wheel also adds `OCP/IVtk*`.

So whichever wheel is written last wins, and uninstalling either one deletes files the other needs. uv only warns about this kind of top-level module collision (uv PR #13437). It does not prevent it.

The fix is to install only one OCP distribution. With CadQuery present, drop the no-VTK wheel:

```toml
[tool.uv]
override-dependencies = ["cadquery-ocp-novtk ; sys_platform == 'never'"]
```

The dry run then resolves to `build123d 0.13.0 + cadquery-ocp 8.0.1.1.0 + cadquery-ocp-proxy 8.0.1.1.0 + vtk 9.6.2`, with no `-novtk`. `ocpsvg 0.7.0` and `ocp_gordon 0.3.1` accept either flavour because they depend on `cadquery_ocp_proxy >=8.0,<8.1`. The `cadquery-ocp-proxy` project description says it was designed for exactly this "build123d and CadQuery in one environment" case. The upstream design used `[vtk]`/`[novtk]` extras, but build123d 0.13.0 and `dev` still hard-depend on `-novtk`. The override is my inference and is not upstream-documented. It needs a smoke test of the build123d suite on the VTK wheel.

## Other facts relevant to pins

- **OCP / OCCT mapping** (CadQuery/OCP releases):
  - 8.0.0.0: OCCT 8.0.0
  - 8.0.1.0: OCCT 8.0.1
  - 8.0.1.1: a tweak release "fixing regression with respect to OCP 7.9.3"
  - The PyPI wheels are 8.0.1.0.0 (2026-09-05) and 8.0.1.1.0 (2026-10-05). The bundled `libTK*.so.8.0.1` confirms OCCT 8.0.1.
- **Wheel matrix for 8.0.1.1.0:** cp311 to cp314 on win_amd64, macOS 11 x86_64/arm64, and manylinux_2_28 x86_64/aarch64. There is **no Windows-ARM64 wheel**, which matters for "universally installable". build123d 0.13 requires Python `>=3.11,<3.15`.
- **Known OCCT 8.0.1 regression:** build123d #1474, open since 2026-09-25. Sweeps with `binormal=`/guide give wrong volumes on 8.0.1, caused by a wrong second derivative in `GeomFill_GuideTrihedronAC::D2`. It has been reported upstream as OCCT #1681 with no fix merged. A build123d maintainer recommends "downgrading to the otherwise identical build123d==0.12.0" if you need this. Downstream projects also report OCP-8 API breaks, for example dropped `_s` downcast suffixes (text-to-cad #628). This is a secondary source.
- **Pitfall:** an unpinned `cadquery` next to `build123d==0.13.0` silently resolves to **cadquery 2.3.0**, whose metadata declares no OCP dependency. Always pin CadQuery exactly.
- **Report reconciliation:**
  - The landscape report's "build123d 0.11.1 current" was true only from 2026-07-02 to 2026-09-18, so it is stale.
  - The kernels report's "0.13.0 on OCP 8.0.1" is correct.
  - Its "CadQuery OCP 8 support planned after the June release" is consistent with the facts: support landed on master and has not been released.
  - The plan's "CadQuery 2.8 on OCP 8.0.1" is **wrong**.

## Recommendation for the plan

Pick one OCCT for Tier B and record it in `uv.lock` and in the benchmark harness, including the OCP wheel *flavour*.

- **Preferred (long-term):** OCP 8.0.1.1.0 / OCCT 8.0.1.
  - The MVP ships build123d 0.13.0 on `cadquery-ocp-novtk` (no VTK, smaller desktop bundle).
  - CadQuery is either (a) deferred until a 2.9.0 release, or (b) shipped "experimental" from a pinned master SHA. In case (b), use the override above, accept VTK in the bundle, and run both test suites in CI.
  - Add a regression test for #1474 and avoid guided/binormal sweeps until OCCT #1681 lands.
- **Fallback if the week-12 MVP must use only PyPI releases with both libraries:** OCP 7.9.3.1.1 (build123d 0.12.0 + CadQuery 2.8.0), with the same single-flavour override.
  - This avoids #1474.
  - It commits to an OCP 7.9 to 8 port of any Open3DJ code written against raw OCP, such as the element map and TNaming. The `OCP.collections` rename makes that port non-trivial.
- **Never ship two OCCT versions side by side in one Tier B runtime.**

## Sources

- PyPI CadQuery history: https://pypi.org/project/cadquery/#history and 2.8.0 metadata: https://pypi.org/pypi/cadquery/2.8.0/json
- PyPI build123d history: https://pypi.org/project/build123d/#history and metadata: https://pypi.org/pypi/build123d/0.13.0/json, https://pypi.org/pypi/build123d/0.12.0/json
- cadquery-ocp: https://pypi.org/project/cadquery-ocp/#history, novtk: https://pypi.org/project/cadquery-ocp-novtk/, proxy: https://pypi.org/project/cadquery-ocp-proxy/
- build123d v0.13.0 release: https://github.com/gumyr/build123d/releases/tag/v0.13.0 and dev pyproject: https://github.com/gumyr/build123d/blob/dev/pyproject.toml
- CadQuery master setup.py: https://github.com/CadQuery/cadquery/blob/master/setup.py and PRs https://github.com/CadQuery/cadquery/pull/2076, https://github.com/CadQuery/cadquery/pull/2099
- OCP releases: https://github.com/CadQuery/OCP/releases
- build123d #1474: https://github.com/gumyr/build123d/issues/1474 and OCCT #1681: https://github.com/Open-Cascade-SAS/OCCT/issues/1681
- uv module-conflict warning: https://github.com/astral-sh/uv/pull/13437
- Downstream OCP-8 migration notes: https://github.com/earthtojake/text-to-cad/pull/628
