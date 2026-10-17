package io.github.gilbertgo.mdrun

import androidx.activity.ComponentActivity
import androidx.wear.ambient.AmbientLifecycleObserver

// 시계 화면이 어두워질 때(앰비언트) 시계 화면으로 바뀌지 않고 이 앱을 어둡게 계속 보여 줘요
fun attachAmbient(a: ComponentActivity, onEnter: () -> Unit, onUpdate: () -> Unit, onExit: () -> Unit) {
    val cb = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) = onEnter()
        override fun onUpdateAmbient() = onUpdate()
        override fun onExitAmbient() = onExit()
    }
    a.lifecycle.addObserver(AmbientLifecycleObserver(a, cb))
}
