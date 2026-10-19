# Read-only installation integrity diagnosis

Use a trusted Node runtime to run installation-integrity.cjs when StarNet cannot start. This utility complements installed-smoke.mjs and installed-customer-regressions.cjs: those exercise running installed code; this one reads selected files without loading them. It does not fix or establish the cause of support incident 85f602c4. A reported empty shell.js remains a report until bytes are collected.

Example in PowerShell (explicit operator-selected directories):

~~~powershell
node scripts/qa/installation-integrity.cjs --installation 'C:\Chosen\StarNet' --reference 'C:\Chosen\ExtractedSameInstaller'
~~~

To include the shipped Cargo/NSIS desktop binary, add explicit selections (these replace defaults):

~~~powershell
node scripts/qa/installation-integrity.cjs --installation 'C:\Chosen\StarNet' --reference 'C:\Chosen\ExtractedSameInstaller' --file skynet-desktop.exe --file node.exe --file sidecar/tools/builtin/shell.js
~~~

For a native payload use --file skynet-desktop with the directory containing that binary. Neither executable is launched.

The reference must be a separate directory containing the actual extracted installer payload, with the same relative layout. Do not point it at a Git checkout: checkout newline conversion and packaging transformations can change bytes. The utility does not download, extract, run, or authenticate the reference package. Record its origin/version separately. Matching files prove byte equality to that reference, not that the reference is correct or that the application works.

Default selection: node.exe, sidecar/index.js, sidecar/loop.js, and sidecar/tools/builtin/shell.js. Repeated --file options replace the default selection. Only node, node.exe, skynet-desktop.exe, native skynet-desktop, StarNet.exe and sidecar JS/CJS/MJS paths are permitted; traversal, arbitrary profile/config paths, directories and symbolic links/junctions are refused. No directory tree or user profile is enumerated. For a non-Windows payload, explicitly select its runtime name and sidecar files.

~~~powershell
node scripts/qa/installation-integrity.cjs --installation 'C:\Chosen\StarNet' --file sidecar/tools/builtin/shell.js --installer 'C:\Chosen\StarNet-setup.exe' --signature
~~~

--installer reads only that explicitly supplied file for size and SHA-256. --signature additionally queries Windows Get-AuthenticodeSignature through the system PowerShell with a literal environment-supplied path; it never launches the installer. This opt-in uses the OS signature verifier, whose certificate/trust behavior follows machine policy; it is not promised to be network-isolated. On other platforms signature metadata remains unverified. Missing installers, unsigned installers and signature-query failures remain distinct. A valid signature result alone is not a full provenance or safety verdict. Without --signature no signature command runs; without --installer no installer is searched for.

JSON goes to stdout only; the utility writes no report file, stamp, bug record or application data. An operator can redirect output to a NEW evidence file outside the inspected directories. Output contains explicit local paths and signer metadata; review/redact those before sharing. No file contents are emitted.

Each selected installed/reference file records observed size, raw SHA-256, or a read-error code. Comparison meanings:

- missing: selected installed path was not found.
- empty: selected installed file has zero bytes (even if the reference is also empty).
- mismatch: both files are nonempty/readable but raw hashes differ.
- match: both files are nonempty/readable and raw hashes agree.
- unverified: no usable reference, read failure, refused link/non-file, or observed file change during reading.

The reference's separate evidence distinguishes absent, empty and unreadable reference paths. Summary counts cover selected files only. Disk capacity/free/available bytes are observed for the explicitly supplied installation directory; they do not prove whether space was exhausted during an earlier installation. Read errors and free-space data do not establish antivirus interference, extraction failure, deletion, permissions as a root cause, or customer recovery. Reads may affect OS access-time metadata; the utility does not write file content or modification times. It detects observed changes during reads but is not an atomic snapshot against concurrent writers or malicious path substitution; collect evidence while installation/update operations are idle.

Exit 0 means a JSON diagnostic report was produced, including reports with missing or mismatched files. Exit 2 means invalid invocation or an unexpected top-level failure. An --installation path that does not exist or is not a directory is an invalid invocation: the CLI prints the reason and exits 2 without a report, so a mistyped path never reads as every selected file missing. Consumers must inspect per-file states and must not turn exit 0 into an installed-health stamp.

Focused verification: node test/installation-integrity.test.js (registered in test/fast.list). Disposable fixtures cover exact raw bytes including CRLF differences, missing/empty/corrupt files, missing/empty/omitted reference, read errors, directories, junctions, path restrictions, OS signature metadata for a synthetic non-PE installer on Windows, and actual CLI nonexecution/data preservation. No customer installation, customer profile, real installer, network provider or account is used. Full combined gates and actual affected-installation collection belong to the coordinating lane.
