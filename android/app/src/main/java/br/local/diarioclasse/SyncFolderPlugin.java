package br.local.diarioclasse;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SyncFolder")
public class SyncFolderPlugin extends Plugin {
    private static final String PREFERENCES = "diario_sync_folder";
    private static final String FOLDER_URI_KEY = "folder_uri";
    private static final String SECURE_FOLDER_NAME = "Diario de Classe - Dados protegidos";
    private static final String CURRENT_FILE_NAME = "diario-atual.json";
    private static final String MANIFEST_FILE_NAME = "manifesto.json";
    private static final String VERSION_PREFIX = "diario-versao-";
    private static final String LOCK_FILE_NAME = "diario-em-uso.lock.json";

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "chooseFolderResult");
    }

    @ActivityCallback
    private void chooseFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Seleção de pasta cancelada.");
            return;
        }
        try {
            Uri uri = result.getData().getData();
            int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            DocumentFile selectedFolder = DocumentFile.fromTreeUri(getContext(), uri);
            if (selectedFolder == null || !selectedFolder.canRead() || !selectedFolder.canWrite()) {
                call.reject("A pasta escolhida não permite leitura e gravação.");
                return;
            }
            DocumentFile secureFolder = resolveSecureFolder(selectedFolder);
            preferences().edit().putString(FOLDER_URI_KEY, uri.toString()).apply();
            call.resolve(folderResult(secureFolder, true));
        } catch (Exception error) {
            call.reject("Não foi possível preparar a pasta de sincronização.", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        DocumentFile folder = configuredFolder();
        if (folder == null || !folder.canRead() || !folder.canWrite()) {
            call.resolve(new JSObject().put("configured", false));
            return;
        }
        call.resolve(folderResult(folder, true));
    }

    @PluginMethod
    public void loadLatest(PluginCall call) {
        try {
            DocumentFile folder = configuredFolder();
            if (folder == null || !folder.canRead()) {
                call.resolve(new JSObject().put("configured", false).put("found", false));
                return;
            }
            DocumentFile latest = manifestCurrentFile(folder);
            if (latest == null || !latest.isFile()) latest = newestSyncFile(folder);
            if (latest == null) {
                call.resolve(new JSObject().put("configured", true).put("found", false).put("folderName", folder.getName()));
                return;
            }
            byte[] content = readBytes(latest.getUri());
            JSObject result = folderResult(folder, true);
            result.put("found", true);
            result.put("fileName", latest.getName());
            result.put("modifiedAt", latest.lastModified());
            result.put("data", Base64.encodeToString(content, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível ler a pasta de sincronização.", error);
        }
    }

    @PluginMethod
    public void listVersions(PluginCall call) {
        try {
            DocumentFile folder = configuredFolder();
            if (folder == null || !folder.canRead()) {
                call.resolve(new JSObject().put("configured", false).put("versions", new JSONArray()));
                return;
            }
            String currentName = manifestCurrentName(folder);
            JSONArray versions = new JSONArray();
            for (DocumentFile file : syncFiles(folder)) {
                JSObject item = new JSObject();
                String name = file.getName();
                item.put("name", name);
                item.put("modifiedAt", file.lastModified());
                item.put("current", (currentName != null && currentName.equals(name)) || (currentName == null && CURRENT_FILE_NAME.equals(name)));
                versions.put(item);
            }
            JSObject result = folderResult(folder, true);
            result.put("versions", versions);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Nao foi possivel listar as versoes salvas.", error);
        }
    }

    @PluginMethod
    public void loadFile(PluginCall call) {
        String fileName = call.getString("fileName", "");
        if (!isAllowedSyncFileName(fileName)) {
            call.reject("Arquivo de sincronizacao invalido.");
            return;
        }
        try {
            DocumentFile folder = configuredFolder();
            if (folder == null || !folder.canRead()) {
                call.reject("Escolha uma pasta de sincronizacao antes de restaurar.");
                return;
            }
            DocumentFile file = folder.findFile(fileName);
            if (file == null || !file.isFile()) {
                call.reject("Versao nao encontrada na pasta.");
                return;
            }
            byte[] content = readBytes(file.getUri());
            JSObject result = folderResult(folder, true);
            result.put("fileName", file.getName());
            result.put("modifiedAt", file.lastModified());
            result.put("data", Base64.encodeToString(content, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Nao foi possivel abrir essa versao.", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String text = call.getString("text");
        String deviceId = call.getString("deviceId", "");
        int keepVersions = Math.max(1, call.getInt("keepVersions", 4));
        if (text == null) {
            call.reject("Nenhum dado foi recebido para salvar.");
            return;
        }
        try {
            DocumentFile folder = configuredFolder();
            if (folder == null || !folder.canWrite()) {
                call.reject("Escolha uma pasta de sincronização antes de salvar.");
                return;
            }
            JSONObject lock = readLock(folder.findFile(LOCK_FILE_NAME));
            if (lock == null || !deviceId.equals(lock.optString("deviceId", "")) || lock.optLong("expiresAt", 0) <= System.currentTimeMillis()) {
                call.reject("A pasta não está bloqueada por este dispositivo. Abra o diário novamente antes de salvar.");
                return;
            }
            String stamp = new SimpleDateFormat("yyyy-MM-dd-HHmmss", Locale.US).format(new Date());
            DocumentFile version = folder.createFile("application/json", VERSION_PREFIX + stamp + "-" + UUID.randomUUID() + ".json");
            if (version == null) throw new IllegalStateException("Não foi possível criar a versão de segurança.");
            writeText(version, text);
            writeText(findOrCreateFile(folder, CURRENT_FILE_NAME), text);
            writeText(findOrCreateFile(folder, MANIFEST_FILE_NAME), buildManifest(text, version.getName()));
            trimVersions(folder, keepVersions);
            JSObject result = folderResult(folder, true);
            result.put("fileName", version.getName());
            result.put("savedAt", System.currentTimeMillis());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível salvar na pasta de sincronização.", error);
        }
    }

    @PluginMethod
    public void acquireLock(PluginCall call) {
        try {
            DocumentFile folder = configuredFolder();
            if (folder == null || !folder.canWrite()) {
                call.resolve(new JSObject().put("acquired", false).put("configured", false));
                return;
            }
            String deviceId = call.getString("deviceId", "");
            String deviceLabel = call.getString("deviceLabel", "Outro dispositivo");
            long leaseMs = call.getLong("leaseMs", 1200000L);
            DocumentFile lockFile = folder.findFile(LOCK_FILE_NAME);
            JSONObject current = readLock(lockFile);
            long now = System.currentTimeMillis();
            if (current != null && current.optLong("expiresAt", 0) > now && !deviceId.equals(current.optString("deviceId", ""))) {
                call.resolve(lockResult(false, current));
                return;
            }
            JSONObject next = new JSONObject();
            next.put("deviceId", deviceId);
            next.put("deviceLabel", deviceLabel);
            next.put("acquiredAt", now);
            next.put("expiresAt", now + leaseMs);
            writeText(findOrCreateFile(folder, LOCK_FILE_NAME), next.toString());
            call.resolve(lockResult(true, next));
        } catch (Exception error) {
            call.reject("Não foi possível bloquear a pasta de sincronização.", error);
        }
    }

    @PluginMethod
    public void refreshLock(PluginCall call) {
        try {
            DocumentFile folder = configuredFolder();
            String deviceId = call.getString("deviceId", "");
            long leaseMs = call.getLong("leaseMs", 1200000L);
            if (folder == null) {
                call.resolve(new JSObject().put("acquired", false));
                return;
            }
            DocumentFile lockFile = folder.findFile(LOCK_FILE_NAME);
            JSONObject current = readLock(lockFile);
            if (current == null || !deviceId.equals(current.optString("deviceId", ""))) {
                call.resolve(lockResult(false, current));
                return;
            }
            current.put("expiresAt", System.currentTimeMillis() + leaseMs);
            writeText(lockFile, current.toString());
            call.resolve(lockResult(true, current));
        } catch (Exception error) {
            call.reject("Não foi possível renovar o bloqueio da pasta.", error);
        }
    }

    @PluginMethod
    public void releaseLock(PluginCall call) {
        try {
            DocumentFile folder = configuredFolder();
            String deviceId = call.getString("deviceId", "");
            if (folder != null) {
                DocumentFile lockFile = folder.findFile(LOCK_FILE_NAME);
                JSONObject current = readLock(lockFile);
                if (lockFile != null && current != null && deviceId.equals(current.optString("deviceId", ""))) lockFile.delete();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível liberar o bloqueio da pasta.", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE);
    }

    private DocumentFile configuredFolder() {
        String value = preferences().getString(FOLDER_URI_KEY, "");
        if (value == null || value.isEmpty()) return null;
        DocumentFile selectedFolder = DocumentFile.fromTreeUri(getContext(), Uri.parse(value));
        if (selectedFolder == null || !selectedFolder.canRead()) return null;
        if (!selectedFolder.canWrite()) return selectedFolder;
        return resolveSecureFolder(selectedFolder);
    }

    private DocumentFile resolveSecureFolder(DocumentFile folder) {
        if (SECURE_FOLDER_NAME.equals(folder.getName())) return folder;
        return ensureSecureFolder(folder);
    }

    private DocumentFile ensureSecureFolder(DocumentFile parent) {
        DocumentFile existing = parent.findFile(SECURE_FOLDER_NAME);
        if (existing != null && existing.isDirectory()) return existing;
        DocumentFile created = parent.createDirectory(SECURE_FOLDER_NAME);
        if (created == null) throw new IllegalStateException("Não foi possível criar a pasta protegida.");
        return created;
    }

    private JSObject folderResult(DocumentFile folder, boolean configured) {
        JSObject result = new JSObject();
        result.put("configured", configured);
        result.put("folderName", folder.getName());
        return result;
    }

    private DocumentFile replaceFile(DocumentFile folder, String name) {
        DocumentFile existing = folder.findFile(name);
        if (existing != null && !existing.delete()) throw new IllegalStateException("Não foi possível atualizar o arquivo principal.");
        DocumentFile created = folder.createFile("application/json", name);
        if (created == null) throw new IllegalStateException("Não foi possível criar o arquivo principal.");
        return created;
    }

    private DocumentFile findOrCreateFile(DocumentFile folder, String name) {
        DocumentFile existing = folder.findFile(name);
        if (existing != null && existing.isFile()) return existing;
        DocumentFile created = folder.createFile("application/json", name);
        if (created == null) throw new IllegalStateException("Não foi possível criar o arquivo de bloqueio.");
        return created;
    }

    private String buildManifest(String text, String versionName) throws Exception {
        JSONObject payload = new JSONObject(text);
        JSONObject current = new JSONObject();
        current.put("fileName", versionName);
        current.put("mirrorFileName", CURRENT_FILE_NAME);
        current.put("snapshotId", payload.optString("snapshotId", ""));
        current.put("exportedAt", payload.optString("exportedAt", new Date().toString()));
        current.put("sourceDeviceId", payload.optString("sourceDeviceId", ""));
        current.put("sourceDevice", payload.optString("sourceDevice", ""));
        current.put("integrity", payload.optJSONObject("integrity"));

        JSONObject manifest = new JSONObject();
        manifest.put("type", "checkout-turmas-sync-manifest");
        manifest.put("manifestVersion", 1);
        manifest.put("updatedAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date()));
        manifest.put("current", current);
        return manifest.toString(2);
    }

    private boolean isAllowedSyncFileName(String name) {
        if (name == null || name.contains("/") || name.contains("\\") || name.contains("..")) return false;
        return CURRENT_FILE_NAME.equals(name) || (name.startsWith(VERSION_PREFIX) && name.endsWith(".json"));
    }

    private String manifestCurrentName(DocumentFile folder) {
        try {
            DocumentFile manifestFile = folder.findFile(MANIFEST_FILE_NAME);
            if (manifestFile == null || !manifestFile.isFile()) return null;
            JSONObject manifest = new JSONObject(new String(readBytes(manifestFile.getUri()), StandardCharsets.UTF_8));
            JSONObject current = manifest.optJSONObject("current");
            return current != null ? current.optString("fileName", null) : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private DocumentFile manifestCurrentFile(DocumentFile folder) {
        String currentName = manifestCurrentName(folder);
        if (currentName == null || !isAllowedSyncFileName(currentName)) return null;
        return folder.findFile(currentName);
    }

    private JSONObject readLock(DocumentFile file) {
        if (file == null || !file.isFile()) return null;
        try {
            return new JSONObject(new String(readBytes(file.getUri()), StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            return null;
        }
    }

    private JSObject lockResult(boolean acquired, JSONObject lock) {
        JSObject result = new JSObject();
        result.put("acquired", acquired);
        if (lock != null) {
            result.put("holder", lock.optString("deviceLabel", "Outro dispositivo"));
            result.put("expiresAt", lock.optLong("expiresAt", 0));
        }
        return result;
    }

    private DocumentFile newestVersion(DocumentFile folder) {
        List<DocumentFile> versions = versions(folder);
        return versions.isEmpty() ? null : versions.get(0);
    }

    private DocumentFile newestSyncFile(DocumentFile folder) {
        List<DocumentFile> files = syncFiles(folder);
        return files.isEmpty() ? null : files.get(0);
    }

    private List<DocumentFile> syncFiles(DocumentFile folder) {
        List<DocumentFile> files = new ArrayList<>();
        DocumentFile current = folder.findFile(CURRENT_FILE_NAME);
        if (current != null && current.isFile()) files.add(current);
        files.addAll(versions(folder));
        Collections.sort(files, (left, right) -> Long.compare(right.lastModified(), left.lastModified()));
        return files;
    }

    private void trimVersions(DocumentFile folder, int limit) {
        List<DocumentFile> versions = versions(folder);
        for (int index = limit; index < versions.size(); index += 1) versions.get(index).delete();
    }

    private List<DocumentFile> versions(DocumentFile folder) {
        List<DocumentFile> versions = new ArrayList<>();
        for (DocumentFile file : folder.listFiles()) {
            String name = file.getName();
            if (file.isFile() && name != null && name.startsWith(VERSION_PREFIX) && name.endsWith(".json")) versions.add(file);
        }
        Collections.sort(versions, (left, right) -> Long.compare(right.lastModified(), left.lastModified()));
        return versions;
    }

    private byte[] readBytes(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Arquivo indisponível.");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private void writeText(DocumentFile file, String text) throws Exception {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
            if (output == null) throw new IllegalStateException("Arquivo indisponível para gravação.");
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
