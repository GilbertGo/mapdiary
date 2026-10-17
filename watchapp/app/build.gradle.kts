// MD Run 갤럭시워치 앱. 휴대폰 MD Run과 같은 이름(appId)·같은 서명이라 나중에 시계 ↔ 휴대폰으로 기록을 넘길 수 있어요
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
val run = (System.getenv("RUN_NUMBER") ?: "1").toInt()
android {
    namespace = "io.github.gilbertgo.mdrun"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.gilbertgo.mdrun"
        minSdk = 30          // Wear OS 3 이상 (갤럭시워치4부터)
        targetSdk = 35
        versionCode = run
        versionName = "0.1.$run"
    }
    signingConfigs {
        getByName("debug") {
            storeFile = file("../../runapp/debug.keystore")
            storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android"
        }
    }
    buildTypes { getByName("debug") { signingConfig = signingConfigs.getByName("debug") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.wear:wear:1.3.0")
}
