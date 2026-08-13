# -*- mode: python ; coding: utf-8 -*-
"""
ErabiFlow gemma_daemon PyInstaller spec file

ビルド:
    cd python-sidecar
    pyinstaller build_daemon.spec

出力:
    dist/gemma_daemon/gemma_daemon.exe
"""

import sys
import os

block_cipher = None

# gemma_daemon.py のあるディレクトリ
spec_dir = os.path.dirname(os.path.abspath(SPEC))

a = Analysis(
    [os.path.join(spec_dir, 'gemma_daemon.py')],
    pathex=[spec_dir],
    binaries=[],
    datas=[],
    hiddenimports=[
        # --- gemma_engine.py ---
        'gemma_engine',

        # --- pipeline モジュール ---
        'pipeline.chunker',
        'pipeline.transcriber',
        'pipeline.audio_analysis',
        'pipeline.highlight_scorer',
        'pipeline.media_signal_analyzer',
        'pipeline.analysis_response',
        'pipeline.game_glossary',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 不要なモジュールを除外してサイズ削減
        'tkinter',
        'matplotlib',
        'pytest',
        'IPython',
        'jupyter',
        'notebook',
        'librosa',
        'numpy',
        'scipy',
        'sklearn',
        'numba',
        'llvmlite',
        'soundfile',
        'audioread',
        'cv2',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='gemma_daemon',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # コンソールアプリ（stdin/stdout IPC用）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='gemma_daemon',
)
