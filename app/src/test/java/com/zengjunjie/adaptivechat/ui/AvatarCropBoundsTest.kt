package com.zengjunjie.adaptivechat.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AvatarCropBoundsTest {
    @Test
    fun `default crop is centered and square`() {
        assertEquals(
            AvatarCropBounds(left = 500, top = 0, size = 2000),
            avatarCropBounds(width = 3000, height = 2000, zoom = 1f, panX = 0f, panY = 0f),
        )
    }

    @Test
    fun `zoom and pan stay within source bounds`() {
        val rightBottom = avatarCropBounds(width = 1200, height = 1800, zoom = 3f, panX = -1f, panY = -1f)
        assertEquals(AvatarCropBounds(left = 800, top = 1400, size = 400), rightBottom)

        val leftTop = avatarCropBounds(width = 1200, height = 1800, zoom = 3f, panX = 1f, panY = 1f)
        assertEquals(AvatarCropBounds(left = 0, top = 0, size = 400), leftTop)
    }
}
