# The app's own Tauri plugin is looked up by name from Rust over JNI
# (src-tauri/src/storage.rs), so nothing in the Java graph references it and R8
# would otherwise rename or drop it from the release build.
-keep class com.aprinote.app.StoragePlugin {
  public <init>(...);
  @app.tauri.annotation.Command public <methods>;
}

# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile