#include <windows.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show) {
    (void)instance; (void)previous; (void)show;
    wchar_t directory[32768], command[65536];
    DWORD length = GetModuleFileNameW(NULL, directory, 32768);
    if (!length || length >= 32768) return 1;
    wchar_t *slash = wcsrchr(directory, L'\\');
    if (!slash) return 1;
    *slash = L'\0';
    BOOL stop = wcscmp(arguments, L"--stop") == 0;
    if (swprintf(command, 65536, L"\"%ls\\node.exe\" \"%ls\\orbita.cjs\"%ls",
                 directory, directory, stop ? L" --stop" : L"") < 0) return 1;
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    startup.cb = sizeof(startup);
    if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                        NULL, directory, &startup, &process)) {
        MessageBoxW(NULL, L"Não foi possível iniciar o Órbita. Reinstale o aplicativo.", L"Órbita", MB_OK | MB_ICONERROR);
        return 1;
    }
    CloseHandle(process.hThread);
    DWORD result = 0;
    if (WaitForSingleObject(process.hProcess, stop ? 10000 : 2500) == WAIT_OBJECT_0) {
        GetExitCodeProcess(process.hProcess, &result);
        if (result && !stop)
            MessageBoxW(NULL, L"Falha ao iniciar. Consulte %LOCALAPPDATA%\\Orbita\\startup-error.log. A porta 31043 pode estar ocupada.", L"Órbita", MB_OK | MB_ICONERROR);
    }
    CloseHandle(process.hProcess);
    return (int)result;
}
